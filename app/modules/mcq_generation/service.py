# app/modules/mcq_generation/service.py
"""MCQ generation logic (rule-based + DeepSeek LLM)."""

from __future__ import annotations

import json
import random
import re
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.llm_client import call_deepseek_chat
from app.modules.mcq_generation import schemas
from app.modules.mcq_management import models as mcq_models


# ---------------------------------------------------------------------------
# Utility: extract a valid JSON block from an LLM response
# ---------------------------------------------------------------------------

def _extract_json_block(raw: str) -> str:
    """
    Extract a clean JSON object from an LLM response.

    Handles cases such as:
    - ```json ... ```
    - ``` ... ```
    - extra explanation before or after the JSON
    - natural-language text mixed with JSON

    Returns a best-effort substring from the first '{' to the last '}'.
    """
    text = (raw or "").strip()

    # Handle fenced code blocks ```json ... ```
    if text.startswith("```"):
        lines = text.splitlines()

        # Drop the opening ``` or ```json
        if lines:
            lines = lines[1:]

        # Drop ending ```
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]

        text = "\n".join(lines).strip()

    # Extract JSON substring from '{' to '}'
    first = text.find("{")
    last = text.rfind("}")

    if first != -1 and last != -1 and last > first:
        return text[first:last + 1]

    # Fallback: return original text (let json.loads fail if needed)
    return text


def _norm_label(x: str) -> str:
    """Normalize labels like 'A.' / 'A:' / ' a ' -> 'A'."""
    s = str(x or "").strip().upper()
    s = re.sub(r"[.:]$", "", s)
    return s


def _stem_key(stem: str) -> str:
    """Key to de-dupe stems (case/space insensitive)."""
    s = (stem or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s


# ---------------------------------------------------------------------------
# Difficulty helpers (stable, explainable)
# ---------------------------------------------------------------------------

def _difficulty_guidelines(difficulty: str) -> str:
    """
    Return prompt-friendly constraints for requested difficulty.
    """
    diff = (difficulty or "").strip().lower()
    if diff == "easy":
        return (
            "Difficulty: EASY.\n"
            "- Focus on definitions, basic facts, or direct recall from the lecture.\n"
            "- Use straightforward wording; avoid tricky negations (NOT/EXCEPT).\n"
            "- Make distractors clearly incorrect and less similar to the correct answer.\n"
        )
    if diff == "medium":
        return (
            "Difficulty: MEDIUM.\n"
            "- Focus on conceptual understanding and simple application.\n"
            "- May involve comparing two related concepts from the lecture.\n"
            "- Distractors should be plausible but still distinguishable.\n"
        )
    if diff == "hard":
        return (
            "Difficulty: HARD.\n"
            "- Focus on deeper reasoning, multi-step understanding, or subtle distinctions.\n"
            "- Distractors should be highly plausible and semantically close to the correct answer.\n"
            "- You MAY include one negation-style question (e.g., NOT/EXCEPT) occasionally, but keep it clear.\n"
        )
    return ""


def infer_difficulty(stem: str) -> str:
    """
    Lightweight difficulty inference for labels when user did NOT choose a difficulty.
    This prevents obviously-easy questions from being shown as "Hard".

    Rule of thumb:
    - Easy: direct definition/meaning/type/basic recall
    - Medium: compare/why/purpose/relationship/basic application
    - Hard: multi-step, calculation, scenario-based reasoning, subtle exception
    """
    s = (stem or "").strip().lower()

    # Easy patterns (direct recall / definition)
    easy_starts = (
        "what is",
        "what does",
        "which is",
        "define",
        "stands for",
        "what type",
        "what are",
        "which of the following is",
    )
    if s.startswith(easy_starts) and "not" not in s and "except" not in s:
        return "easy"

    # Hard cues (multi-step / compute / scenario)
    hard_cues = (
        "calculate",
        "compute",
        "derive",
        "evaluate",
        "given",
        "based on the scenario",
        "best next step",
        "most appropriate action",
        "which statement is false",
        "not",
        "except",
    )
    if any(w in s for w in hard_cues):
        # NOT/EXCEPT can be medium or hard; we treat as hard to be conservative.
        return "hard"

    # Medium cues (conceptual understanding / compare)
    medium_cues = (
        "difference",
        "purpose",
        "relationship",
        "why",
        "how does",
        "which best describes",
        "which of the following best",
        "compare",
        "contrast",
    )
    if any(w in s for w in medium_cues):
        return "medium"

    return "medium"


# ---------------------------------------------------------------------------
# Retrieve lecture text
# ---------------------------------------------------------------------------

def resolve_lecture_text(db: Session, params: schemas.MCQGenerateRequest) -> str:
    """
    Resolve the lecture text either from the request payload
    or from the database (lecture or section).
    """
    if getattr(params, "lecture_text", None):
        return params.lecture_text

    stmt = (
        select(mcq_models.Lecture)
        .options(joinedload(mcq_models.Lecture.sections))
        .where(mcq_models.Lecture.id == params.lecture_id)
    )
    lecture = db.execute(stmt).unique().scalar_one_or_none()

    if lecture is None:
        raise ValueError("Lecture not found.")

    # If section_id is provided, return that section only
    if getattr(params, "section_id", None):
        section = next((s for s in lecture.sections if s.id == params.section_id), None)
        if section is None:
            raise ValueError("Section not found for the given lecture.")
        return section.content

    # Otherwise, merge all ordered sections
    ordered = sorted(lecture.sections, key=lambda s: s.order_index)
    if ordered:
        return "\n\n".join(s.content for s in ordered)

    # Fallback: plain cleaned lecture text
    return lecture.clean_text


# ---------------------------------------------------------------------------
# Stub fallback questions (for offline testing)
# ---------------------------------------------------------------------------

def generate_stub_questions(
    params: schemas.MCQGenerateRequest,
) -> List[schemas.GeneratedQuestion]:
    """Return deterministic placeholder MCQs for testing."""
    requested_diff = (getattr(params, "difficulty", None) or "").strip().lower() or None

    q = schemas.GeneratedQuestion(
        stem="Which concept best describes the placeholder lecture topic?",
        options=[
            schemas.GeneratedOption(label="A", text="Correct concept (stub)"),
            schemas.GeneratedOption(label="B", text="Distractor 1"),
            schemas.GeneratedOption(label="C", text="Distractor 2"),
            schemas.GeneratedOption(label="D", text="Distractor 3"),
        ],
        correct_label="A",
        difficulty=requested_diff or infer_difficulty("Which concept best describes the placeholder lecture topic?"),
    )
    return [q] * params.num_questions


# ---------------------------------------------------------------------------
# MCQ generation using DeepSeek
# ---------------------------------------------------------------------------

def generate_mcqs_with_llm(
    lecture_text: str,
    num_questions: int = 3,
    difficulty: Optional[str] = None,  # None => infer per question
) -> List[schemas.GeneratedQuestion]:
    """
    Generate MCQs using DeepSeek's chat model.

    Stability fixes:
    - Enforce EXACT output size.
    - Batch for larger counts to avoid truncation/invalid JSON.
    - Validate each MCQ strictly (exactly 4 options, one correct_label).
    - De-dupe stems to reduce duplicates across batches.

    Difficulty behaviour:
    - If difficulty is provided (easy/medium/hard): we guide prompt AND label all questions with that difficulty.
    - If difficulty is None: we DO NOT stamp everything as 'hard'; we infer per question.
    """
    if num_questions <= 0:
        raise ValueError("num_questions must be a positive integer.")

    diff_norm = (difficulty or "").strip().lower()
    if diff_norm not in {"", "easy", "medium", "hard"}:
        raise ValueError("difficulty must be one of: easy, medium, hard (or omitted).")

    system_prompt = (
        "You are an expert university MCQ writer. "
        "Generate clear questions with exactly four options (labels A-D) and only one correct answer. "
        "Respond with JSON only. Do not include markdown fences or commentary."
    )

    schema_example = {
        "questions": [
            {
                "stem": "question text",
                "options": [
                    {"label": "A", "text": "..."},
                    {"label": "B", "text": "..."},
                    {"label": "C", "text": "..."},
                    {"label": "D", "text": "..."},
                ],
                "correct_label": "A",
            }
        ]
    }

    guidelines = _difficulty_guidelines(diff_norm) if diff_norm else ""

    def _call_once(k: int) -> List[schemas.GeneratedQuestion]:
        user_prompt = (
            f"Lecture text:\n{lecture_text}\n\n"
            + (f"{guidelines}\n" if guidelines else "")
            + f"Generate EXACTLY {k} high-quality MCQs about the material above. "
              "Each MCQ must contain exactly four options (A-D) and one `correct_label`.\n\n"
              "Return JSON following this schema exactly:\n"
            + f"{json.dumps(schema_example, indent=2)}"
        )

        raw = call_deepseek_chat(system_prompt, user_prompt)
        cleaned = _extract_json_block(raw)

        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise ValueError("DeepSeek returned invalid JSON for MCQ generation.") from exc

        questions_payload = parsed.get("questions")
        if not isinstance(questions_payload, list):
            raise ValueError("DeepSeek response missing a valid 'questions' list.")

        batch: List[schemas.GeneratedQuestion] = []

        for item in questions_payload:
            if not isinstance(item, dict):
                continue

            stem = item.get("stem")
            options_in = item.get("options")
            correct_label_in = item.get("correct_label")

            if not isinstance(stem, str) or not stem.strip():
                continue
            if not isinstance(options_in, list) or len(options_in) != 4:
                continue
            if not isinstance(correct_label_in, str) or not correct_label_in.strip():
                continue

            correct_label_in_n = _norm_label(correct_label_in)

            # Ensure each option has {label,text}
            original_options = []
            ok = True
            for opt in options_in:
                if not isinstance(opt, dict):
                    ok = False
                    break
                lab = _norm_label(opt.get("label"))
                txt = opt.get("text")
                if lab not in {"A", "B", "C", "D"}:
                    ok = False
                    break
                if not isinstance(txt, str) or not txt.strip():
                    ok = False
                    break
                original_options.append({"label": lab, "text": txt})

            if not ok:
                continue

            # Shuffle options so correct answer is not always at position A
            random.shuffle(original_options)

            reshuffled_options: List[schemas.GeneratedOption] = []
            correct_label_new: str | None = None

            for idx, opt in enumerate(original_options):
                new_label = chr(ord("A") + idx)  # A, B, C, D

                reshuffled_options.append(
                    schemas.GeneratedOption(
                        label=new_label,
                        text=opt["text"],
                    )
                )

                if opt["label"] == correct_label_in_n:
                    correct_label_new = new_label

            if correct_label_new is None:
                continue

            final_stem = stem.strip()
            final_diff = diff_norm or infer_difficulty(final_stem)

            batch.append(
                schemas.GeneratedQuestion(
                    stem=final_stem,
                    options=reshuffled_options,
                    correct_label=correct_label_new,
                    difficulty=final_diff,
                )
            )

        return batch

    # --------------------------
    # Batch + Retry Controller
    # --------------------------
    BATCH_SIZE = 8
    MAX_TRIES_PER_BATCH = 3
    MAX_TOTAL_BATCHES = 10

    collected: List[schemas.GeneratedQuestion] = []
    seen: set[str] = set()
    remaining = num_questions
    batches_done = 0

    while remaining > 0 and batches_done < MAX_TOTAL_BATCHES:
        k = min(BATCH_SIZE, remaining)

        batch: List[schemas.GeneratedQuestion] = []
        last_err: Exception | None = None

        for _ in range(MAX_TRIES_PER_BATCH):
            try:
                batch = _call_once(k)
                last_err = None
                break
            except ValueError as e:
                last_err = e
                continue

        if last_err is not None and not batch:
            raise ValueError(
                f"DeepSeek failed to generate a valid batch of {k} MCQs. "
                f"Last error: {last_err}"
            )

        for q in batch:
            key = _stem_key(q.stem)
            if key in seen:
                continue
            seen.add(key)
            collected.append(q)
            remaining -= 1
            if remaining <= 0:
                break

        batches_done += 1

    if len(collected) < num_questions:
        raise ValueError(
            f"DeepSeek did not produce enough valid MCQs. "
            f"Requested {num_questions}, got {len(collected)}."
        )

    return collected[:num_questions]
