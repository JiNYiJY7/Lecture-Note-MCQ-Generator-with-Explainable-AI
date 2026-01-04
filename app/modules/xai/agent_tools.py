from __future__ import annotations
import re
from typing import Any
from litellm import completion

from app.core.database import SessionLocal
from app.core.llm_client import call_deepseek_chat
from app.modules.xai import schemas as xai_schemas
from app.modules.mcq_management import models as mcq_models

OFFLINE_MODEL = "ollama/llama3.2:1b"
CACHE_VERSION = "ai_generated_v2"  # ✅ NEW VERSION TAG: Invalidates all old/buggy cache automatically.


def _normalize_choice_label(x: Any) -> str:
    """Extracts 'A', 'B', 'C', or 'D' from the input."""
    s = str(x or "").strip()
    if not s: return ""
    # Look for strict single letter A-D first
    m = re.search(r"\b([A-D])\b", s, flags=re.IGNORECASE)
    if m: return m.group(1).upper()
    # Fallback: take first character if it's likely a letter
    return s[:1].upper()


def _generate_ai_explanation(
        lecture_text: str, question_stem: str, student_text: str,
        correct_text: str, is_correct: bool, use_offline: bool = False
) -> str:
    """
    Generate explanation using separate prompts for Correct vs Incorrect.
    """

    # ---------------------------------------------------------
    # 1. SPLIT PROMPTS (Strict Logic)
    # ---------------------------------------------------------
    if is_correct:
        print("   🛡️ [LOGIC] User is CORRECT. Asking AI to confirm.")
        prompt = f"""
        CONTEXT: {lecture_text[:1500]}\n\n
        QUESTION: {question_stem}\n
        ANSWER: {student_text}\n\n

        TASK: Explain why this answer is CORRECT based on the context.
        FORMAT: Start with "Correct - ". Keep it strictly under 2 sentences.
        """
    else:
        print("   🛡️ [LOGIC] User is INCORRECT. Hiding real answer to force explanation.")
        # ⚠️ We do NOT show the real answer here. This forces the AI to check the student's answer against the text.
        prompt = f"""
        CONTEXT: {lecture_text[:1500]}\n\n
        QUESTION: {question_stem}\n
        STUDENT WRONG CHOICE: {student_text}\n\n

        TASK: Explain why the STUDENT CHOICE is INCORRECT based on the context.
        - Point out the error in the student's choice.
        - Do NOT mention the correct answer key.

        FORMAT: Start with "Incorrect - ". Keep it strictly under 2 sentences.
        """

    # ---------------------------------------------------------
    # 2. RUN MODEL
    # ---------------------------------------------------------
    try:
        if use_offline:
            print(f"   🔌 Tool generating with {OFFLINE_MODEL}...")
            response = completion(
                model=OFFLINE_MODEL,
                messages=[{"role": "user", "content": prompt}],
                api_base="http://localhost:11434",
                timeout=60
            )

            content = response.choices[0].message.content
            if not content or not content.strip():
                return f"{'Correct' if is_correct else 'Incorrect'} - (No explanation)."

            # Clean up quotes
            cleaned = content.strip().replace('"', '')

            # ---------------------------------------------------------
            # 3. SAFETY FORCE-FIX
            # ---------------------------------------------------------
            target_prefix = "Correct -" if is_correct else "Incorrect -"

            # Remove any messy existing prefix
            lower = cleaned.lower()
            if lower.startswith("correct -"):
                cleaned = cleaned[9:].strip()
            elif lower.startswith("incorrect -"):
                cleaned = cleaned[11:].strip()
            elif lower.startswith("correct"):
                cleaned = cleaned[7:].strip()
            elif lower.startswith("incorrect"):
                cleaned = cleaned[9:].strip()

            # Force attach the correct prefix
            cleaned = f"{target_prefix} {cleaned}"
            return cleaned

        else:
            return call_deepseek_chat("You are a tutor.", prompt).strip().replace('"', '')

    except Exception as e:
        print(f"   ❌ Tool generation failed: {e}")
        return f"{'Correct' if is_correct else 'Incorrect'} - (Error: {e})."


def explain_mcq_answer_tool(
        question_id: int, student_answer_label: str,
        use_offline: bool = False,
        **kwargs
) -> str:
    """Checks answer, checks cache, generates explanation, and saves to DB."""
    db = SessionLocal()
    try:
        # 1. Fetch Question
        from app.modules.mcq_management import service as mcq_service
        q = mcq_service.get_question_by_id(db, question_id)
        if not q: return "Error: Question not found."

        # 2. Check Logic (WITH DEBUGGING)
        student_label = _normalize_choice_label(student_answer_label)
        correct_label = _normalize_choice_label(q.answer_key.correct_option.label)
        is_correct = (student_label == correct_label)

        student_text = ""
        correct_text = ""
        selected_option_id = None

        for o in q.options:
            norm = _normalize_choice_label(o.label)
            if norm == student_label:
                student_text = o.text
                selected_option_id = o.id
            if norm == correct_label:
                correct_text = o.text

        # ✅ DEBUG PRINT: Check your terminal when you click the button!
        print(f"\n   🔍 [DEBUG CHECK] QID: {question_id}")
        print(f"   👉 You picked: {student_label} ('{student_text[:20]}...')")
        print(f"   ✅ Real Answer: {correct_label} ('{correct_text[:20]}...')")
        print(f"   ⚖️ Verdict: {'CORRECT' if is_correct else 'INCORRECT'}")

        # 3. CHECK CACHE (Using NEW version tag)
        if selected_option_id:
            existing = db.query(mcq_models.Explanation).filter(
                mcq_models.Explanation.question_id == question_id,
                mcq_models.Explanation.option_id == selected_option_id,
                mcq_models.Explanation.source == CACHE_VERSION  # <--- Forces new lookup
            ).first()

            if existing:
                print(f"   ⚡ [CACHE] Found valid v2 explanation.")
                return existing.content

        # 4. Generate New Explanation
        ai_explanation = _generate_ai_explanation(
            lecture_text=q.lecture.clean_text,
            question_stem=q.stem,
            student_text=student_text,
            correct_text=correct_text,
            is_correct=is_correct,
            use_offline=use_offline
        )

        # 5. SAVE TO CACHE (With NEW version tag)
        if selected_option_id:
            try:
                new_expl = mcq_models.Explanation(
                    question_id=question_id,
                    option_id=selected_option_id,
                    content=ai_explanation,
                    source=CACHE_VERSION,  # <--- Saves as v2
                )
                db.add(new_expl)
                db.commit()
                print(f"   💾 [CACHE] Saved new v2 explanation.")
            except Exception:
                db.rollback()

        return ai_explanation

    except Exception as e:
        return f"Error: {str(e)}"
    finally:
        db.close()