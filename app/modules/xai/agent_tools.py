from __future__ import annotations

import re
from typing import Any, List, Optional

from app.core.database import SessionLocal
from app.modules.xai import schemas as xai_schemas
from app.modules.xai import service as xai_service
from app.modules.mcq_management import models as mcq_models

XAIOption = xai_schemas.XAIOption


def _normalize_choice_label(x: Any) -> str:
    """
    Normalize labels so "B" == "B." == "B:" == "option B" == "Option b".
    """
    s = str(x or "").strip()
    if not s:
        return ""
    m = re.search(r"\b([A-D])\b", s, flags=re.IGNORECASE)
    if m:
        return m.group(1).upper()
    # fallback: first char token
    s = re.sub(r"[.:]$", "", s)
    return s[:1].upper()


def _normalize_options(options: Optional[List[Any]]) -> List[XAIOption]:
    """
    Robust options normalizer.
    Accept:
      - XAIOption objects
      - dicts like {"label": "A", "text": "..."}
      - ORM objects with .label/.text
    Return:
      - list[XAIOption]
    """
    if not options:
        return []

    normalized: List[XAIOption] = []
    for opt in options:
        # XAIOption / ORM with attributes
        if hasattr(opt, "label"):
            normalized.append(
                XAIOption(
                    label=_normalize_choice_label(getattr(opt, "label", "")),
                    text=str(getattr(opt, "text", "") or ""),
                )
            )
            continue

        # dict payload
        if isinstance(opt, dict):
            normalized.append(
                XAIOption(
                    label=_normalize_choice_label(opt.get("label", "")),
                    text=str(opt.get("text", "") or ""),
                )
            )
            continue

        # unknown type fallback
        normalized.append(XAIOption(label=_normalize_choice_label(opt), text=""))

    return normalized


def explain_mcq_answer_tool(
    question_id: int,
    student_answer_label: str,
    lecture_text: Optional[str] = None,
    question_stem: Optional[str] = None,
    options: Optional[List[XAIOption]] = None,
) -> str:
    """
    Checks answer and retrieves/generates explanation specific to the SELECTED OPTION.
    Cache key: (question_id + option_id).
    IMPORTANT: This tool can self-retrieve lecture/stem/options from DB if missing.
    """
    student_answer_label = _normalize_choice_label(student_answer_label)
    print(f"🛠️ AGENT TOOL CALLED: explain_mcq_answer_tool (QID: {question_id}, Choice: {student_answer_label})")

    db = SessionLocal()

    try:
        # 1) Fetch Question details from DB
        from app.modules.mcq_management import service as mcq_service

        db_question = mcq_service.get_question_by_id(db, question_id)
        if not db_question:
            return "Error: Question ID not found in database."

        # 2) Determine correct label + selected option id
        correct_label_str = None
        selected_option_id = None

        # Prefer answer_key if present
        if getattr(db_question, "answer_key", None) and getattr(db_question.answer_key, "correct_option", None):
            correct_label_str = _normalize_choice_label(db_question.answer_key.correct_option.label)

        # Scan options
        for opt in db_question.options:
            opt_label = _normalize_choice_label(opt.label)

            if getattr(opt, "is_correct", False) and not correct_label_str:
                correct_label_str = opt_label

            if opt_label == student_answer_label:
                selected_option_id = opt.id

        if not correct_label_str:
            return "Error: Could not determine correct answer."

        if not selected_option_id:
            return f"Error: Option '{student_answer_label}' does not exist for this question."

        # 3) Cache check (question_id + option_id)
        existing_explanation = (
            db.query(mcq_models.Explanation)
            .filter(
                mcq_models.Explanation.question_id == question_id,
                mcq_models.Explanation.option_id == selected_option_id,
            )
            .first()
        )

        reasoning_text = ""
        explanation_source = "UNKNOWN"
        is_correct = (student_answer_label == correct_label_str)

        if existing_explanation:
            print(f"   ⚡ CACHE HIT: Found saved explanation for Option {student_answer_label} (ID: {selected_option_id})")
            reasoning_text = existing_explanation.content
            explanation_source = "DATABASE (VERIFIED)"
        else:
            print(f"   🐢 CACHE MISS: Generating specific explanation for Option {student_answer_label}...")
            explanation_source = "AI_GENERATED (FRESH)"

            # --- Always self-retrieve if missing ---
            if not lecture_text:
                lecture_text = db_question.lecture.clean_text if getattr(db_question, "lecture", None) else ""
            if not question_stem:
                question_stem = db_question.stem

            # If agent passed options as dicts, normalize them.
            # If nothing passed, take DB options.
            if options:
                safe_options = _normalize_options(options)
            else:
                safe_options = [
                    XAIOption(label=_normalize_choice_label(opt.label), text=str(opt.text or ""))
                    for opt in db_question.options
                ]

            generated_response = xai_service.build_explanation(
                lecture_text=lecture_text,
                question_stem=question_stem,
                options=safe_options,
                correct_label=correct_label_str,
                student_label=student_answer_label,
            )
            reasoning_text = generated_response.reasoning

            # --- Save specific explanation ---
            try:
                new_expl = mcq_models.Explanation(
                    question_id=question_id,
                    option_id=selected_option_id,
                    content=reasoning_text,
                    source="ai_agent_generated",
                )
                db.add(new_expl)
                db.commit()
                print(f"   💾 SAVED explanation for Option {student_answer_label}.")
            except Exception as e:
                print(f"   ⚠️ Warning: Failed to save explanation: {e}")
                db.rollback()

        # 4) Construct output
        status_msg = "CORRECT" if is_correct else "INCORRECT"

        student_text = next(
            (o.text for o in db_question.options if o.id == selected_option_id),
            "Unknown"
        )

        correct_text = "Unknown"
        for o in db_question.options:
            if _normalize_choice_label(o.label) == correct_label_str:
                correct_text = o.text
                break

        additional_instruction = ""
        if explanation_source == "AI_GENERATED (FRESH)":
            additional_instruction = "5. Since this explanation is AI-generated, ensure it strictly aligns with the Correct Answer."

        tool_output = f"""
[SYSTEM DATA]
STATUS: {status_msg}
SOURCE: {explanation_source}
STUDENT ANSWER: {student_answer_label} ("{student_text}")
CORRECT ANSWER: {correct_label_str} ("{correct_text}")

EXPLANATION CONTENT (Specific to Option {student_answer_label}):
"{reasoning_text}"

[INSTRUCTIONS FOR AGENT]
1. Start with "Correct" or "Incorrect".
2. Provide exactly ONE sentence explaining why, using the evidence.
3. If incorrect, provide ONE sentence identifying what idea led them to the chosen answer.
4. Keep it to 1-2 sentences max.
{additional_instruction}
""".strip()

        return tool_output

    except Exception as e:
        print(f"❌ TOOL ERROR: {str(e)}")
        return f"Error retrieving data: {str(e)}"

    finally:
        db.close()
