from __future__ import annotations

import re
import json
from typing import Any, List, Optional

from app.core.database import SessionLocal
from app.core.llm_client import call_deepseek_chat  # Add this import
from app.modules.xai import schemas as xai_schemas
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
    """
    if not options:
        return []

    normalized: List[XAIOption] = []
    for opt in options:
        if hasattr(opt, "label"):
            normalized.append(
                XAIOption(
                    label=_normalize_choice_label(getattr(opt, "label", "")),
                    text=str(getattr(opt, "text", "") or ""),
                )
            )
            continue

        if isinstance(opt, dict):
            normalized.append(
                XAIOption(
                    label=_normalize_choice_label(opt.get("label", "")),
                    text=str(opt.get("text", "") or ""),
                )
            )
            continue

        normalized.append(XAIOption(label=_normalize_choice_label(opt), text=""))

    return normalized


def _generate_ai_explanation(
        lecture_text: str,
        question_stem: str,
        student_text: str,
        correct_text: str,
        is_correct: bool,
        question_type: str = "concept"
) -> str:
    """
    Use DeepSeek to generate a specific explanation based on lecture content.
    Returns explanation in the required format.
    """
    if not lecture_text:
        # Fallback if no lecture text
        if is_correct:
            return "Correct - Your answer is correct based on the lecture content."
        else:
            return "Incorrect - Your answer doesn't match the lecture content. You likely chose this because the selected option doesn't align with the evidence."

    # Prepare prompt for the LLM
    system_prompt = """You are an AI tutor explaining MCQ answers. 
Your task is to generate VERY concise explanations (1-2 sentences max).
Format your response EXACTLY as:
- For correct answers: "Correct - [one sentence explanation]"
- For incorrect answers: "Incorrect - [one sentence]. You likely chose this because [one sentence]"

DO NOT add any other text. DO NOT mention the format instructions.
DO NOT reveal the correct answer letter (A/B/C/D)."""

    user_prompt = f"""LECTURE CONTENT:
{lecture_text[:2000]}  # Limit length

QUESTION: {question_stem}

STUDENT'S SELECTED ANSWER: {student_text}
CORRECT ANSWER: {correct_text}
QUESTION TYPE: {question_type}
IS STUDENT CORRECT: {'Yes' if is_correct else 'No'}

Generate explanation in the required format."""

    try:
        # Call DeepSeek
        response = call_deepseek_chat(system_prompt, user_prompt)

        # Extract just the explanation part
        if "Correct - " in response:
            # Find everything after "Correct - "
            start = response.find("Correct - ")
            explanation = response[start:].strip()
            # Take only up to the first period after the explanation
            if "." in explanation:
                end = explanation.find(".", explanation.find("Correct - ") + 10)
                if end != -1:
                    explanation = explanation[:end + 1]
            return explanation
        elif "Incorrect - " in response:
            # Find everything after "Incorrect - "
            start = response.find("Incorrect - ")
            explanation = response[start:].strip()
            # Ensure it has the misconception part
            if "You likely chose this because" not in explanation:
                # Add generic misconception
                explanation += " You likely chose this because the selected option doesn't match the lecture evidence."
            # Take only up to the end
            if "." in explanation:
                # Find last complete sentence
                last_period = explanation.rfind(".")
                explanation = explanation[:last_period + 1]
            return explanation
        else:
            # Fallback if format not followed
            if is_correct:
                return f"Correct - {response[:100]}."
            else:
                return f"Incorrect - {response[:100]}. You likely chose this because the selected option doesn't match the lecture evidence."

    except Exception as e:
        print(f"❌ AI Explanation Generation Error: {e}")
        # Fallback
        if is_correct:
            return "Correct - Your answer is correct based on the lecture content."
        else:
            return "Incorrect - Your answer doesn't match the lecture content. You likely chose this because the selected option doesn't align with the evidence."


def explain_mcq_answer_tool(
        question_id: int,
        student_answer_label: str,
        lecture_text: Optional[str] = None,
        question_stem: Optional[str] = None,
        options: Optional[List[XAIOption]] = None,
) -> str:
    """
    Checks answer and uses AI to generate specific explanation.
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

        # 2) Determine correct label
        correct_label_str = None
        if getattr(db_question, "answer_key", None) and getattr(db_question.answer_key, "correct_option", None):
            correct_label_str = _normalize_choice_label(db_question.answer_key.correct_option.label)

        if not correct_label_str:
            for opt in db_question.options:
                if getattr(opt, "is_correct", False):
                    correct_label_str = _normalize_choice_label(opt.label)
                    break

        if not correct_label_str:
            return "Error: Could not determine correct answer."

        # 3) Get option texts
        student_text = ""
        correct_text = ""
        question_type = "concept"

        for opt in db_question.options:
            opt_label = _normalize_choice_label(opt.label)
            if opt_label == student_answer_label:
                student_text = opt.text or ""
            if opt_label == correct_label_str:
                correct_text = opt.text or ""

        is_correct = (student_answer_label == correct_label_str)

        # 4) Determine question type for better explanation
        stem_lower = db_question.stem.lower()
        if "definition" in stem_lower or "what is" in stem_lower:
            question_type = "definition"
        elif "purpose" in stem_lower or "why" in stem_lower:
            question_type = "purpose"
        elif "difference" in stem_lower or "compare" in stem_lower:
            question_type = "comparison"
        elif "example" in stem_lower or "instance" in stem_lower:
            question_type = "example"

        # 5) Get lecture text if not provided
        if not lecture_text:
            lecture_text = db_question.lecture.clean_text if getattr(db_question, "lecture", None) else ""
        if not question_stem:
            question_stem = db_question.stem

        # 6) Check cache for existing AI-generated explanation
        selected_option_id = None
        for opt in db_question.options:
            if _normalize_choice_label(opt.label) == student_answer_label:
                selected_option_id = opt.id
                break

        if selected_option_id:
            existing_explanation = (
                db.query(mcq_models.Explanation)
                .filter(
                    mcq_models.Explanation.question_id == question_id,
                    mcq_models.Explanation.option_id == selected_option_id,
                    mcq_models.Explanation.source == "ai_generated"
                )
                .first()
            )

            if existing_explanation:
                print(f"   ⚡ CACHE HIT: Found AI-generated explanation for Option {student_answer_label}")
                return existing_explanation.content

        # 7) Generate AI explanation
        print(f"   🤖 GENERATING AI explanation for Option {student_answer_label}...")
        ai_explanation = _generate_ai_explanation(
            lecture_text=lecture_text,
            question_stem=question_stem,
            student_text=student_text,
            correct_text=correct_text,
            is_correct=is_correct,
            question_type=question_type
        )

        # 8) Save to cache
        if selected_option_id:
            try:
                new_expl = mcq_models.Explanation(
                    question_id=question_id,
                    option_id=selected_option_id,
                    content=ai_explanation,
                    source="ai_generated",
                )
                db.add(new_expl)
                db.commit()
                print(f"   💾 SAVED AI-generated explanation for Option {student_answer_label}.")
            except Exception as e:
                print(f"   ⚠️ Warning: Failed to save explanation: {e}")
                db.rollback()

        return ai_explanation

    except Exception as e:
        print(f"❌ TOOL ERROR: {str(e)}")
        # Fallback to ensure we always return something
        if is_correct:
            return "Correct - Your answer is correct based on the lecture content."
        else:
            return "Incorrect - Your answer doesn't match the lecture content. You likely chose this because the selected option doesn't align with the evidence."
    finally:
        db.close()