"""FastAPI router for XAI explanations."""

from __future__ import annotations

import re
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
# Helper function to clean agent response
# ----------------------------
def clean_agent_response(agent_text: str) -> str:
    """
    Clean up the agent's response to ensure clean format.
    """
    if not agent_text or not agent_text.strip():
        return "No response from AI Tutor."

    # If it already has our format, return as is
    if agent_text.startswith("Correct - ") or agent_text.startswith("Incorrect - "):
        if not agent_text.endswith('.'):
            agent_text += '.'
        return agent_text

    # Try to extract our format via Regex
    correct_match = re.search(r'Correct\s*-\s*([^\.]+\.?)', agent_text, re.IGNORECASE)
    if correct_match:
        explanation = correct_match.group(1).strip()
        if not explanation.endswith('.'):
            explanation += '.'
        return f"Correct - {explanation}"

    incorrect_match = re.search(r'Incorrect\s*-\s*([^\.]+\.?)(?:\s*You likely chose this because\s*([^\.]+\.?))?',
                                agent_text, re.IGNORECASE | re.DOTALL)
    if incorrect_match:
        explanation = incorrect_match.group(1).strip()
        misconception = incorrect_match.group(2)

        if not misconception:
            misconception = "the selected option doesn't match the lecture evidence"
        else:
            misconception = misconception.strip()

        if not explanation.endswith('.'):
            explanation += '.'
        if misconception.endswith('.'):
            misconception = misconception[:-1]

        return f"Incorrect - {explanation} You likely chose this because {misconception}."

    # FALLBACK: If regex fails, return the raw text instead of empty string
    cleaned = agent_text[:500].strip()
    return cleaned if cleaned else "AI Response was empty."


# ----------------------------
# Chat endpoint
# ----------------------------
@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(payload: ChatRequest):
    """Send a message to the AI Tutor Agent."""
    try:
        # 1. Send message to manager
        response_text = await chat_manager.send_message(
            session_id=payload.session_id,
            user_msg=payload.message,
            user_id=payload.user_id,
            use_offline=payload.use_offline
        )

        # ✅ DEBUG LOG: See exactly what the tool returned
        print(f"🔎 DEBUG RAW AGENT RESPONSE: '{response_text}'")

        # 2. Clean up the response
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
    """
    try:
        if payload.question_id and payload.question_id != 0:
            # DB mode
            lecture_text, stem, options, correct_label = service.load_question_bundle(
                db=db, question_id=payload.question_id
            )
        else:
            # Stateless mode
            if not (payload.question_stem and payload.options and payload.correct_label and payload.lecture_text):
                raise ValueError("Invalid stateless payload")

            lecture_text = payload.lecture_text
            stem = payload.question_stem
            options = payload.options
            correct_label = payload.correct_label

        resp = service.build_explanation(
            lecture_text=lecture_text,
            question_stem=stem,
            options=options,
            correct_label=correct_label,
            student_label=payload.student_answer_label,
        )
        return resp

    except Exception as exc:
        print("❌ /xai/explain crashed:", repr(exc))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))