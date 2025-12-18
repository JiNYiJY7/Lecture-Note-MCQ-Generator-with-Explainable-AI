"""Service layer encapsulating MCQ management operations."""

from __future__ import annotations

from typing import List, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.modules.mcq_management import models, schemas


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

def get_all_lectures(db: Session) -> List[models.Lecture]:
    """List all lectures sorted by newest first."""
    return (
        db.query(models.Lecture)
        .filter(models.Lecture.is_active == True)  # Filter out deleted ones
        .order_by(models.Lecture.created_at.desc())
        .all()
    )

# Add new function
def soft_delete_lecture(db: Session, lecture_id: int):
    """Mark a lecture as inactive (soft delete)."""
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
    """
    Return all questions for a given lecture (optionally filtered by section).

    The result is fully eager-loaded with options, answer key, and explanations
    so that the API can return a rich JSON response in one go.
    """
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

    # IMPORTANT for joinedload on collections in SQLAlchemy 2.0
    result = db.execute(query).unique()
    return list(result.scalars().all())


def get_question_by_id(db: Session, question_id: int) -> models.Question | None:
    """
    Fetch a single question with all its related data.
    """
    query = (
        select(models.Question)
        .options(
            joinedload(models.Question.options),
            joinedload(models.Question.answer_key).joinedload(
                models.AnswerKey.correct_option
            ),
            joinedload(models.Question.explanations),
        )
        .where(models.Question.id == question_id)
    )

    result = db.execute(query).unique()
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# CRUD for questions/options/answer keys
# ---------------------------------------------------------------------------


def _persist_options(
    db: Session,
    question: models.Question,
    options: List[schemas.OptionCreate],
) -> List[models.Option]:
    """
    Helper to create Option rows attached to a Question.
    """
    option_models: List[models.Option] = []

    for opt in options:
        option_models.append(
            models.Option(
                question=question,
                label=opt.label,
                text=opt.text,
                is_correct=opt.is_correct,
            )
        )

    db.add_all(option_models)
    return option_models


def create_question_with_options_and_answer_key(
    db: Session,
    payload: schemas.QuestionCreate,
) -> models.Question:
    """
    Create a full MCQ (question + options + answer key) in one transaction.
    """
    question = models.Question(
        lecture_id=payload.lecture_id,
        section_id=payload.section_id,
        stem=payload.stem,
        difficulty=payload.difficulty,
    )
    db.add(question)
    db.flush()  # populate question.id

    options = _persist_options(db, question, payload.options)
    db.flush()

    correct_option = next(
        (opt for opt in options if opt.label == payload.answer_key.correct_option_label),
        None,
    )
    if correct_option is None:
        raise ValueError("Correct option label does not match provided options.")

    answer_key = models.AnswerKey(
        question=question,
        correct_option_id=correct_option.id,
    )
    db.add(answer_key)

    db.commit()
    db.refresh(question)
    return question


# ---------------------------------------------------------------------------
# XAI explanations
# ---------------------------------------------------------------------------


def save_or_update_explanation(
    db: Session,
    question_id: int,
    payload: schemas.ExplanationCreate,
) -> models.Explanation:
    """
    Insert or update an explanation for a given question.
    """
    explanation = (
        db.query(models.Explanation)
        .filter(models.Explanation.question_id == question_id)
        .first()
    )

    if explanation:
        explanation.content = payload.content
        explanation.source = payload.source
    else:
        explanation = models.Explanation(
            question_id=question_id,
            content=payload.content,
            source=payload.source,
        )
        db.add(explanation)

    db.commit()
    db.refresh(explanation)
    return explanation


def list_explanations_by_question(
    db: Session,
    question_id: int,
) -> List[models.Explanation]:
    """
    List all explanations (history) for a specific question.
    """
    return (
        db.query(models.Explanation)
        .filter(models.Explanation.question_id == question_id)
        .order_by(models.Explanation.created_at.desc())
        .all()
    )


# ---------------------------------------------------------------------------
# Bridge for LLM-generated MCQs
# ---------------------------------------------------------------------------


def save_generated_questions(
    db: Session,
    lecture_id: int | None,
    section_id: int | None,
    questions: Sequence,
) -> list[int]:
    """
    Persist a batch of generated MCQs into the database.

    Parameters
    ----------
    db : Session
        Active SQLAlchemy session.
    lecture_id : int | None
        Lecture this MCQ set belongs to.
    section_id : int | None
        Optional section focus for the questions.
    questions : Sequence
        Objects with attributes: stem, options, correct_label.

    Returns
    -------
    list[int]
        List of created Question IDs (one for each MCQ).
    """
    created_ids: list[int] = []

    for q in questions:
        # 1) Question row
        question = models.Question(
            lecture_id=lecture_id,
            section_id=section_id,
            stem=getattr(q, "stem", ""),
            difficulty="medium",  # default difficulty; can be tuned later
        )
        db.add(question)
        db.flush()  # ensure question.id is available

        # 2) Option rows
        option_models: list[models.Option] = []
        for opt in q.options:
            option = models.Option(
                question=question,
                label=opt.label,
                text=opt.text,
                is_correct=(opt.label == q.correct_label),
            )
            db.add(option)
            option_models.append(option)

        db.flush()  # ensure option IDs are available

        # 3) Answer key row
        correct_option = next(
            (opt for opt in option_models if opt.label == q.correct_label),
            None,
        )
        if correct_option is None:
            raise ValueError("Generated MCQ has no matching correct option label.")

        answer_key = models.AnswerKey(
            question=question,
            correct_option_id=correct_option.id,
        )
        db.add(answer_key)

        created_ids.append(question.id)

    db.commit()
    return created_ids
