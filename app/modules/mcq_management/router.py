"""FastAPI router for MCQ persistence and retrieval."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.mcq_management import schemas, service

router = APIRouter(prefix="/mcq-management", tags=["MCQ Management"])


@router.get("/lectures/{lecture_id}/questions", response_model=list[schemas.QuestionWithOptionsAndAnswerKey])
def list_questions(
    lecture_id: int,
    section_id: int | None = None,
    db: Session = Depends(get_db),
):
    """List questions for a lecture, optionally scoped to a section."""

    questions = service.list_questions_by_lecture_and_section(
        db=db, lecture_id=lecture_id, section_id=section_id
    )
    return [
        schemas.QuestionWithOptionsAndAnswerKey.from_orm(question) for question in questions
    ]


@router.get("/questions/{question_id}", response_model=schemas.QuestionWithOptionsAndAnswerKey)
def get_question(question_id: int, db: Session = Depends(get_db)):
    """Fetch a single question with options and answer key."""

    question = service.get_question_by_id(db=db, question_id=question_id)
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    return schemas.QuestionWithOptionsAndAnswerKey.from_orm(question)


@router.post("/questions", response_model=schemas.QuestionWithOptionsAndAnswerKey, status_code=201)
def create_question(payload: schemas.QuestionCreate, db: Session = Depends(get_db)):
    """Create a question along with its options and answer key in one call."""

    try:
        question = service.create_question_with_options_and_answer_key(db=db, payload=payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return schemas.QuestionWithOptionsAndAnswerKey.from_orm(question)


@router.post(
    "/questions/{question_id}/explanations",
    response_model=schemas.ExplanationRead,
    status_code=201,
)
def create_explanation(
    question_id: int, payload: schemas.ExplanationCreate, db: Session = Depends(get_db)
):
    """Persist explainability output so students can review rationale later."""

    explanation = service.save_or_update_explanation(
        db=db, question_id=question_id, payload=payload
    )
    return schemas.ExplanationRead.from_orm(explanation)


@router.get(
    "/questions/{question_id}/explanations",
    response_model=list[schemas.ExplanationRead],
)
def list_explanations(question_id: int, db: Session = Depends(get_db)):
    """Return all explanations generated for a question."""

    items = service.list_explanations_by_question(db=db, question_id=question_id)
    return [schemas.ExplanationRead.from_orm(item) for item in items]

