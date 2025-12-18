"""FastAPI router for XAI explanations."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.xai import schemas as xai_schemas, service

from pydantic import BaseModel
from app.modules.xai.chat_manager import chat_manager

router = APIRouter(prefix="/xai", tags=["XAI & Chat"])

# --- Define Schema for Chat Request ---
class ChatRequest(BaseModel):
    session_id: str
    message: str
    user_id: str = "student_1"

class ChatResponse(BaseModel):
    response: str

# --- Chat Endpoint --- #
@router.post("/chat", response_model=ChatResponse)
async def chat_with_agent(payload: ChatRequest):
    """
    Send a message to the AI Tutor Agent.
    """
    try:
        response_text = await chat_manager.send_message(
            session_id=payload.session_id,
            user_msg=payload.message,
            user_id=payload.user_id
        )
        return ChatResponse(response=response_text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- XAI Endpoint --- #
@router.post("/explain", response_model=xai_schemas.XAIExplanationResponse)
def explain_answer(
    payload: xai_schemas.XAIExplanationRequest,
    db: Session = Depends(get_db),
):
    """
    Explain a student's answer to a generated MCQ.

    Two modes are supported:

    - DB mode:
        * question_id is provided (non-zero)
        * backend looks up lecture text + question + options in the database

    - Stateless mode (used by the current React frontend):
        * question_id is None or 0
        * question_stem, options, correct_label, lecture_text are sent directly
          from the frontend.
    """
    try:
        # Decide which source to use
        if payload.question_id and payload.question_id != 0:
            # DB mode
            lecture_text, stem, options, correct_label = service.load_question_bundle(
                db=db, question_id=payload.question_id
            )
        else:
            # Stateless mode
            if not (
                payload.question_stem
                and payload.options
                and payload.correct_label
                and payload.lecture_text
            ):
                raise ValueError(
                    "Either a valid question_id or full question payload must be provided."
                )

            lecture_text = payload.lecture_text
            stem = payload.question_stem
            options = payload.options
            correct_label = payload.correct_label

        # Run the XAI pipeline
        resp = service.build_explanation(
            lecture_text=lecture_text,
            question_stem=stem,
            options=options,
            correct_label=correct_label,
            student_label=payload.student_answer_label,
        )
        return resp

    except ValueError as exc:
        # User-facing errors (e.g., question not found)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        # Any unexpected error becomes a generic 500
        raise HTTPException(
            status_code=500,
            detail="Unexpected error while generating XAI explanation.",
        ) from exc
