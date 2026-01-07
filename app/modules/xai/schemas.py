# app/modules/xai/schemas.py
"""Pydantic schemas for the XAI (explanation) module."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class XAIOption(BaseModel):
    """Single answer option used by the XAI module."""
    label: str = Field(..., min_length=1, max_length=5)
    text: str


class XAIExplanationRequest(BaseModel):
    """
    Request to explain a student's answer.

    Two modes:

    1) DB mode:
       - question_id provided (non-zero)
       - backend loads question + options + lecture text from the database

    2) Stateless mode:
       - question_id is None or 0
       - question_stem, options, correct_label provided in payload
       - lecture_text is optional (used only for evidence retrieval)
    """

    question_id: Optional[int] = None
    student_answer_label: str = Field(..., min_length=1, max_length=5)

    # Stateless payload fields (used when question_id is None or 0)
    question_stem: Optional[str] = None
    options: Optional[List[XAIOption]] = None
    correct_label: Optional[str] = None
    lecture_text: Optional[str] = None  # optional now

    # Controls
    include_evidence: bool = False


class XAIExplanationResponse(BaseModel):
    """
    Structured explanation for a single MCQ answer.
    """

    is_correct: bool
    student_label: str
    correct_label: str

    reasoning: str
    key_concepts: List[str] = []
    review_topics: List[str] = []
