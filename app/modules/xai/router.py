# app/modules/xai/router.py
"""FastAPI router for XAI explanations."""

from __future__ import annotations

import traceback
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

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
    use_offline: Optional[bool] = False


class ChatResponse(BaseModel):
    response: str


# ----------------------------
# Minimal cleaner (preserve full sentences, avoid truncation)
# ----------------------------
def clean_agent_response(agent_text: str) -> str:
    """
    Minimal cleanup: preserve full sentences and avoid aggressive truncation.
    """
    if not agent_text or not agent_text.strip():
        return "No response from AI Tutor."

    text = agent_text.strip()

    # Keep desired style as-is
    if text.startswith("Correct.") or text.startswith("Incorrect."):
        return text

    # Convert old dash style gently (if any)
    if text.startswith("Correct - "):
        return "Correct. " + text[len("Correct - "):].strip()
    if text.startswith("Incorrect - "):
        return "Incorrect. " + text[len("Incorrect - "):].strip()

    # Return raw (cap only to prevent UI explosion)
    return text[:2000]


# ----------------------------
# Chat endpoint
# ----------------------------
@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(payload: ChatRequest):
    """Send a message to the AI Tutor Agent."""
    try:
        response_text = await chat_manager.send_message(
            session_id=payload.session_id,
            user_msg=payload.message,
            user_id=payload.user_id,
            use_offline=payload.use_offline,
        )

        # DEBUG: See exactly what the tool returned
        print(f"🔎 DEBUG RAW AGENT RESPONSE: '{response_text}'")

        cleaned_response = clean_agent_response(response_text)
        return ChatResponse(response=cleaned_response)

    except Exception as e:
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

    DB mode:
      - payload.question_id != 0
    Stateless mode:
      - question_stem/options/correct_label required
      - lecture_text optional
    """
    try:
        if payload.question_id and payload.question_id != 0:
            lecture_text, stem, options, correct_label = service.load_question_bundle(
                db=db, question_id=payload.question_id
            )
        else:
            if not (payload.question_stem and payload.options and payload.correct_label):
                raise ValueError(
                    "Invalid stateless payload: question_stem/options/correct_label are required."
                )

            lecture_text = payload.lecture_text or ""
            stem = payload.question_stem
            options = payload.options
            correct_label = payload.correct_label

        resp = service.build_explanation(
            lecture_text=lecture_text,
            question_stem=stem,
            options=options,
            correct_label=correct_label,
            student_label=payload.student_answer_label,
            include_evidence=payload.include_evidence,
        )
        return resp

    except Exception as exc:
        print("❌ /xai/explain crashed:", repr(exc))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))
