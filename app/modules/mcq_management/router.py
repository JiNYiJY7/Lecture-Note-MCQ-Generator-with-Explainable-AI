from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.mcq_management import schemas, service

# Prefix for all management endpoints
router = APIRouter(
    prefix="/management",
    tags=["MCQ Management"]
)

@router.get("/lectures/{lecture_id}/questions", response_model=List[schemas.QuestionWithOptionsAndAnswerKey])
def list_questions(
    lecture_id: int,
    section_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Get all questions belonging to a specific lecture.
    Optionally filter by section_id.
    """
    questions = service.list_questions_by_lecture_and_section(
        db=db, 
        lecture_id=lecture_id, 
        section_id=section_id
    )
    return questions

@router.get("/questions/{question_id}", response_model=schemas.QuestionWithOptionsAndAnswerKey)
def get_question(
    question_id: int,
    db: Session = Depends(get_db)
):
    """
    Get a single question with its options and answer key.
    """
    question = service.get_question_by_id(db, question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    return question

@router.post("/questions", response_model=schemas.QuestionRead)
def create_manual_question(
    payload: schemas.QuestionCreate,
    db: Session = Depends(get_db)
):
    """
    Manually create a question (mostly for testing or teacher overrides).
    """
    try:
        question = service.create_question_with_options_and_answer_key(db, payload)
        return question
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))