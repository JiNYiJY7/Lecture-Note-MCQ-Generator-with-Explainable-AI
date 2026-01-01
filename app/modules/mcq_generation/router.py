"""FastAPI router for MCQ generation workflows."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.mcq_generation import schemas, service
from app.modules.mcq_management.service import save_generated_questions

router = APIRouter(prefix="/mcq", tags=["MCQ Generation"])


@router.post("/generate", response_model=schemas.MCQGenerateResponse)
def generate_mcqs(payload: schemas.MCQGenerateRequest, db: Session = Depends(get_db)):
    """
    Generate MCQs for a lecture.

    Behaviour:

    - If `use_llm` is True:
        * Resolve lecture text either from `lecture_text` (direct string)
          or from the database using `lecture_id` + optional `section_id`.
        * Call DeepSeek to generate MCQs from that text.

    - If `use_llm` is False:
        * Return deterministic stub questions for testing.

    Persistence behaviour:

    - If `payload.lecture_id` is NOT None:
        * Save generated questions into the database and return their IDs.

    - If `payload.lecture_id` is None:
        * Do NOT write anything to the database. This matches the current
          UI flow where students simply paste arbitrary lecture text.
    """

    try:
        # 1) Generate questions (LLM or stub)
        if payload.use_llm:
            lecture_text = service.resolve_lecture_text(db=db, params=payload)
            questions = service.generate_mcqs_with_llm(
                lecture_text=lecture_text,
                num_questions=payload.num_questions,
                difficulty=payload.difficulty  # ✅ new (None => mixed)
            )
        else:
            questions = service.generate_stub_questions(params=payload)

        # 2) Optionally persist to DB only when we actually have a lecture_id
        created_ids: list[int] = []
        if payload.lecture_id is not None:
            created_ids = save_generated_questions(
                db=db,
                lecture_id=payload.lecture_id,
                section_id=payload.section_id,
                questions=questions,
            )

    except ValueError as exc:
        # Service layer uses ValueError for user-facing problems
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        # Any unexpected error is wrapped as a 500 with a safe message
        raise HTTPException(
            status_code=500,
            detail="Unexpected error while generating MCQs.",
        ) from exc

    # If we saved them, map the new IDs back to the question objects
    if created_ids:
        for i, q in enumerate(questions):
            q.id = created_ids[i]

    # 3) Return generated MCQs + optional DB IDs
    return schemas.MCQGenerateResponse(
        questions=questions,
        question_ids=created_ids or None,
    )
