from __future__ import annotations
from typing import List, Optional
from app.core.database import SessionLocal
from app.modules.xai import service as xai_service
from app.modules.xai import schemas as xai_schemas
from app.modules.mcq_management import models as mcq_models

XAIOption = xai_schemas.XAIOption


def explain_mcq_answer_tool(
        question_id: int,
        student_answer_label: str,
        lecture_text: Optional[str] = None,
        question_stem: Optional[str] = None,
        options: Optional[List[XAIOption]] = None,
) -> str:
    """
    Checks answer and retrieves/generates explanation specific to the SELECTED OPTION.
    - Matches (Question ID + Option ID).
    """
    print(f"🛠️ AGENT TOOL CALLED: explain_mcq_answer_tool (QID: {question_id}, Choice: {student_answer_label})")

    db = SessionLocal()

    try:
        # 1. Fetch Question details from DB
        from app.modules.mcq_management import service as mcq_service
        db_question = mcq_service.get_question_by_id(db, question_id)

        if not db_question:
            return "Error: Question ID not found in database."

        # 2. Determine Correct Label and SELECTED Option ID
        correct_label_str = None
        selected_option_id = None  # We need this for the DB cache

        # Check answer key first
        if db_question.answer_key and db_question.answer_key.correct_option:
            correct_label_str = db_question.answer_key.correct_option.label

        # Scan options to find correct label AND the user's selected option ID
        for opt in db_question.options:
            if opt.is_correct and not correct_label_str:
                correct_label_str = opt.label

            # Capture the ID of the option the student chose
            if opt.label == student_answer_label:
                selected_option_id = opt.id

        if not correct_label_str:
            return "Error: Could not determine correct answer."

        if not selected_option_id:
            return f"Error: Option '{student_answer_label}' does not exist for this question."

        # ---------------------------------------------------------
        # 3. CACHE CHECK: Query by Question ID AND Option ID
        # ---------------------------------------------------------
        existing_explanation = db.query(mcq_models.Explanation).filter(
            mcq_models.Explanation.question_id == question_id,
            mcq_models.Explanation.option_id == selected_option_id  # <--- NEW SPECIFIC CHECK
        ).first()

        reasoning_text = ""
        explanation_source = "UNKNOWN"
        is_correct = (student_answer_label == correct_label_str)

        if existing_explanation:
            print(
                f"   ⚡ CACHE HIT: Found saved explanation for Option {student_answer_label} (ID: {selected_option_id})")
            reasoning_text = existing_explanation.content
            explanation_source = "DATABASE (VERIFIED)"
        else:
            print(f"   🐢 CACHE MISS: Generating specific explanation for Option {student_answer_label}...")
            explanation_source = "AI_GENERATED (FRESH)"

            # --- GENERATE ---
            if not lecture_text:
                lecture_text = db_question.lecture.clean_text if db_question.lecture else ""
            if not question_stem:
                question_stem = db_question.stem
            if not options:
                options = [
                    xai_schemas.XAIOption(label=opt.label, text=opt.text)
                    for opt in db_question.options
                ]

            generated_response = xai_service.build_explanation(
                lecture_text=lecture_text,
                question_stem=question_stem,
                options=options,
                correct_label=correct_label_str,
                student_label=student_answer_label
            )
            reasoning_text = generated_response.reasoning

            # --- SAVE SPECIFIC EXPLANATION ---
            try:
                new_expl = mcq_models.Explanation(
                    question_id=question_id,
                    option_id=selected_option_id,  # <--- SAVING LINK TO OPTION
                    content=reasoning_text,
                    source="ai_agent_generated"
                )
                db.add(new_expl)
                db.commit()
                print(f"   💾 SAVED explanation for Option {student_answer_label}.")
            except Exception as e:
                print(f"   ⚠️ Warning: Failed to save explanation: {e}")
                db.rollback()

        # 4. Construct Output
        status_msg = "CORRECT" if is_correct else "INCORRECT"

        # Helper strings for context
        student_text = next((o.text for o in db_question.options if o.id == selected_option_id), "Unknown")
        correct_text = "Unknown"
        # Re-find correct text just in case
        for o in db_question.options:
            if o.label == correct_label_str: correct_text = o.text

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
        """

        return tool_output

    except Exception as e:
        print(f"❌ TOOL ERROR: {str(e)}")
        return f"Error retrieving data: {str(e)}"

    finally:
        db.close()