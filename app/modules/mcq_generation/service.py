"""MCQ generation logic (rule-based + DeepSeek LLM)."""

from __future__ import annotations

import json
import random
from typing import List

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
    text = raw.strip()

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
        return text[first : last + 1]

    # Fallback: return original text (let json.loads fail if needed)
    return text


# ---------------------------------------------------------------------------
# Retrieve lecture text
# ---------------------------------------------------------------------------


def resolve_lecture_text(db: Session, params: schemas.MCQGenerateRequest) -> str:
    """
    Resolve the lecture text either from the request payload
    or from the database (lecture or section).
    """
    if params.lecture_text:
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
    if params.section_id:
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

    q = schemas.GeneratedQuestion(
        stem="Which concept best describes the placeholder lecture topic?",
        options=[
            schemas.GeneratedOption(label="A", text="Correct concept (stub)"),
            schemas.GeneratedOption(label="B", text="Distractor 1"),
            schemas.GeneratedOption(label="C", text="Distractor 2"),
            schemas.GeneratedOption(label="D", text="Distractor 3"),
        ],
        correct_label="A",
    )
    # Duplicate the same question `num_questions` times
    return [q] * params.num_questions


# ---------------------------------------------------------------------------
# MCQ generation using DeepSeek
# ---------------------------------------------------------------------------


def generate_mcqs_with_llm(
    lecture_text: str,
    num_questions: int = 3,
) -> List[schemas.GeneratedQuestion]:
    """
    Generate MCQs using DeepSeek's chat model.

    Ensures the LLM output is parsed safely, even if DeepSeek adds explanations,
    code fences, or partial formatting. After parsing, options are shuffled and
    relabelled (A-D) so the correct answer is not always 'A'.
    """

    system_prompt = (
        "You are an expert university MCQ writer. Generate clear questions with exactly four "
        "options (labels A-D) and only one correct answer. Respond with JSON only."
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

    user_prompt = (
        f"Lecture text:\n{lecture_text}\n\n"
        f"Generate {num_questions} high-quality MCQs about the material above. "
        "Each MCQ must contain exactly four options (A-D) and one `correct_label`.\n\n"
        "Return JSON following this schema exactly:\n"
        f"{json.dumps(schema_example, indent=2)}"
    )

    # Call DeepSeek
    raw = call_deepseek_chat(system_prompt, user_prompt)

    # Extract a valid JSON segment from the LLM response
    cleaned = _extract_json_block(raw)

    # Parse JSON
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError("DeepSeek returned invalid JSON for MCQ generation.") from exc

    questions_payload = parsed.get("questions")
    if not isinstance(questions_payload, list):
        raise ValueError("DeepSeek response missing a valid 'questions' list.")

    results: List[schemas.GeneratedQuestion] = []

    try:
        for item in questions_payload:
            original_options = list(item["options"])

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

                # Track which new label corresponds to the original correct option
                if opt["label"] == item["correct_label"]:
                    correct_label_new = new_label

            if correct_label_new is None:
                raise ValueError("Generated MCQ has no matching correct option label.")

            results.append(
                schemas.GeneratedQuestion(
                    stem=item["stem"],
                    options=reshuffled_options,
                    correct_label=correct_label_new,
                )
            )
    except (KeyError, TypeError) as exc:
        raise ValueError("DeepSeek response has an unexpected MCQ structure.") from exc

    return results
