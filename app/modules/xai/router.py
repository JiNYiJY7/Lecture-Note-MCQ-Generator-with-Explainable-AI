"""FastAPI router for XAI explanations."""

from __future__ import annotations

import traceback
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.modules.xai import schemas as xai_schemas, service
from app.modules.xai.chat_manager import chat_manager

router = APIRouter(prefix="/xai", tags=["XAI & Chat"])


# ----------------------------
# Chat schemas
# ----------------------------
class ChatRequest(BaseModel):
    session_id: str
    message: str
    user_id: str = "student_1"


class ChatResponse(BaseModel):
    response: str


# ----------------------------
# Chat endpoint
# ----------------------------
@router.post("/chat", response_model=ChatResponse)
async def chat_with_agent(payload: ChatRequest):
    """Send a message to the AI Tutor Agent."""
    try:
        response_text = await chat_manager.send_message(
            session_id=payload.session_id,
            user_msg=payload.message,
            user_id=payload.user_id,
        )
        return ChatResponse(response=response_text)
    except Exception as e:
        # show real error for debugging
        print("❌ /xai/chat crashed:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ----------------------------
# XAI explain endpoint
# ----------------------------
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
    - Stateless mode:
        * question_id is None or 0
        * question_stem, options, correct_label, lecture_text are sent directly
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
                    "Either a valid question_id OR full payload "
                    "(question_stem, options, correct_label, lecture_text) must be provided."
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
        # User-facing errors
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    except HTTPException:
        # Preserve any explicit HTTPException thrown inside service
        raise

    except Exception as exc:
        # IMPORTANT: print full traceback so you can see the real cause
        print("❌ /xai/explain crashed:", repr(exc))
        traceback.print_exc()

        # Give a slightly more informative (still safe) detail
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error while generating XAI explanation: {type(exc).__name__}",
        ) from exc
