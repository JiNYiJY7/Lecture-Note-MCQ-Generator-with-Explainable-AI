"""Service layer encapsulating MCQ management operations."""

from __future__ import annotations

import json
import re
from typing import List, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.mcq_management import models, schemas

# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------
def get_all_lectures(db: Session) -> List[models.Lecture]:
    return (
        db.query(models.Lecture)
        .filter(models.Lecture.is_active == True)
        .order_by(models.Lecture.created_at.desc())
        .all()
    )

def soft_delete_lecture(db: Session, lecture_id: int):
    lecture = db.query(models.Lecture).filter(models.Lecture.id == lecture_id).first()
    if lecture:
        lecture.is_active = False
        db.commit()
    return lecture

def list_questions_by_lecture_and_section(
    db: Session,
    lecture_id: int,
    section_id: Optional[int] = None,
) -> List[models.Question]:
    query = (
        select(models.Question)
        .options(
            joinedload(models.Question.options),
            joinedload(models.Question.answer_key).joinedload(
                models.AnswerKey.correct_option
            ),
            joinedload(models.Question.explanations),
        )
        .where(models.Question.lecture_id == lecture_id)
        .order_by(models.Question.created_at.desc())
    )
    if section_id is not None:
        query = query.where(models.Question.section_id == section_id)
    result = db.execute(query).unique()
    return list(result.scalars().all())

def get_question_by_id(db: Session, question_id: int) -> models.Question | None:
    query = (
        select(models.Question)
        .options(
            joinedload(models.Question.options),
            joinedload(models.Question.answer_key).joinedload(
                models.AnswerKey.correct_option
            ),
            joinedload(models.Question.explanations),
            joinedload(models.Question.lecture)
        )
        .where(models.Question.id == question_id)
    )
    result = db.execute(query).unique()
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# GENERATION LOGIC
# ---------------------------------------------------------------------------

def generate_questions_via_agent(
    db: Session,
    lecture_id: int,
    num_questions: int,
    difficulty: str = "medium",
    use_offline: bool = False
):
    from app.mcq_chatbot.agent import online_agent, offline_agent

    lecture = db.query(models.Lecture).filter(models.Lecture.id == lecture_id).first()
    if not lecture:
        raise ValueError("Lecture not found")

    text_chunk = lecture.clean_text[:6000] if lecture.clean_text else ""
    target_agent = offline_agent if use_offline else online_agent
    mode_name = "OFFLINE" if use_offline else "ONLINE"

    print(f"🚀 Generating {num_questions} {difficulty} MCQs using {mode_name}...")

    prompt = f"""
    TASK: Generate {num_questions} multiple-choice questions.
    DIFFICULTY LEVEL: {difficulty.upper()}
    
    GUIDELINES:
    - EASY: Basic facts and definitions.
    - MEDIUM: Concepts and relationships.
    - HARD: Application and analysis.

    FORMAT: JSON array ONLY.
    [
      {{
        "stem": "Question text",
        "options": [{{"label": "A", "text": "..."}}, {{"label": "B", "text": "..."}}, ...],
        "correct_label": "A"
      }}
    ]

    TEXT: "{text_chunk}"
    """

    try:
        response = target_agent.query(prompt)
        raw_text = response.text if hasattr(response, "text") else str(response)

        try:
            json_data = json.loads(raw_text)
        except:
            match = re.search(r"\[.*\]", raw_text, re.DOTALL)
            json_data = json.loads(match.group(0)) if match else []

        if not json_data: raise ValueError("No JSON found in response")

        class TempMCQ:
            def __init__(self, data):
                self.stem = data.get('stem') or data.get('question')
                self.correct_label = data.get('correct_label') or data.get('answer')
                self.options = []
                raw_opts = data.get('options', [])
                if isinstance(raw_opts, dict):
                    raw_opts = [{"label": k, "text": v} for k, v in raw_opts.items()]
                for o in raw_opts:
                    if isinstance(o, dict):
                        self.options.append(schemas.OptionCreate(**o))

        parsed_questions = [TempMCQ(q) for q in json_data]

        question_ids = save_generated_questions(
            db=db,
            lecture_id=lecture_id,
            section_id=None,
            questions=parsed_questions,
            difficulty=difficulty
        )

        return {
            "status": "success",
            "mode": mode_name,
            "questions": json_data,
            "question_ids": question_ids
        }
    except Exception as e:
        print(f"❌ Generation Failed: {e}")
        raise e


# ---------------------------------------------------------------------------
# CRUD helpers
# ---------------------------------------------------------------------------
def _persist_options(db: Session, question: models.Question, options: List[schemas.OptionCreate]) -> List[models.Option]:
    option_models: List[models.Option] = []
    for opt in options:
        option_models.append(models.Option(question=question, label=opt.label, text=opt.text, is_correct=opt.is_correct))
    db.add_all(option_models)
    return option_models

def create_question_with_options_and_answer_key(db: Session, payload: schemas.QuestionCreate) -> models.Question:
    question = models.Question(lecture_id=payload.lecture_id, section_id=payload.section_id, stem=payload.stem, difficulty=payload.difficulty)
    db.add(question)
    db.flush()
    options = _persist_options(db, question, payload.options)
    db.flush()
    correct_option = next((opt for opt in options if opt.label == payload.answer_key.correct_option_label), None)
    if correct_option is None:
        raise ValueError("Correct option label does not match provided options.")
    answer_key = models.AnswerKey(question=question, correct_option_id=correct_option.id)
    db.add(answer_key)
    db.commit()
    db.refresh(question)
    return question

def save_or_update_explanation(db: Session, question_id: int, payload: schemas.ExplanationCreate) -> models.Explanation:
    explanation = db.query(models.Explanation).filter(models.Explanation.question_id == question_id).first()
    if explanation:
        explanation.content = payload.content
        explanation.source = payload.source
    else:
        explanation = models.Explanation(question_id=question_id, content=payload.content, source=payload.source)
        db.add(explanation)
    db.commit()
    db.refresh(explanation)
    return explanation

def list_explanations_by_question(db: Session, question_id: int) -> List[models.Explanation]:
    return db.query(models.Explanation).filter(models.Explanation.question_id == question_id).order_by(models.Explanation.created_at.desc()).all()


def save_generated_questions(
    db: Session,
    lecture_id: int | None,
    section_id: int | None,
    questions: Sequence,
    difficulty: str = "medium"
) -> list[int]:
    created_ids: list[int] = []
    for q in questions:
        final_diff = getattr(q, "difficulty", None) or difficulty

        question = models.Question(
            lecture_id=lecture_id,
            section_id=section_id,
            stem=getattr(q, "stem", ""),
            difficulty=final_diff
        )
        db.add(question)
        db.flush()
        option_models: list[models.Option] = []
        for opt in q.options:
            option = models.Option(question=question, label=opt.label, text=opt.text, is_correct=(opt.label == q.correct_label))
            db.add(option)
            option_models.append(option)
        db.flush()
        correct_option = next((opt for opt in option_models if opt.label == q.correct_label), None)
        if correct_option is None:
            correct_option = next((o for o in option_models if o.is_correct), option_models[0])
        answer_key = models.AnswerKey(question=question, correct_option_id=correct_option.id)
        db.add(answer_key)
        created_ids.append(question.id)
    db.commit()
    return created_ids