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

    There are two modes:

    1) DB mode (classic):
       - question_id is provided (non-zero)
       - backend loads question + options + lecture text from the database

    2) Stateless mode (for the current frontend):
       - question_id is None or 0
       - question_stem, options, correct_label, lecture_text are provided
         directly in the payload.
    """

    question_id: Optional[int] = None
    student_answer_label: str = Field(..., min_length=1, max_length=5)

    # Stateless payload fields (used when question_id is None or 0)
    question_stem: Optional[str] = None
    options: Optional[List[XAIOption]] = None
    correct_label: Optional[str] = None
    lecture_text: Optional[str] = None


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
