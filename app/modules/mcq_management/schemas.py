"""Pydantic schemas for MCQ management endpoints (Pydantic v2 ready)."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, ConfigDict


# ---------------------------------------------------------------------------
# Option schemas
# ---------------------------------------------------------------------------

class OptionBase(BaseModel):
    label: str = Field(..., min_length=1, max_length=5)
    text: str
    is_correct: bool = False


class OptionCreate(OptionBase):
    """Payload used when creating options."""
    pass


class OptionRead(OptionBase):
    """Option returned from the API."""

    id: int

    # Pydantic v2: replace orm_mode = True
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Answer key schemas
# ---------------------------------------------------------------------------

class AnswerKeyCreate(BaseModel):
    """Client specifies the correct option by its label."""
    correct_option_label: str


class AnswerKeyRead(BaseModel):
    id: int
    correct_option_id: int
    correct_option: OptionRead | None = None

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Explanation schemas (for XAI)
# ---------------------------------------------------------------------------

class ExplanationCreate(BaseModel):
    content: str
    source: Optional[str] = None


class ExplanationRead(BaseModel):
    id: int
    content: str
    source: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Question schemas
# ---------------------------------------------------------------------------

class QuestionCreate(BaseModel):
    lecture_id: int
    section_id: Optional[int] = None
    stem: str
    difficulty: Optional[str] = "medium"
    options: List[OptionCreate]
    answer_key: AnswerKeyCreate


class QuestionRead(BaseModel):
    id: int
    lecture_id: int
    section_id: Optional[int]
    stem: str
    difficulty: Optional[str]

    model_config = ConfigDict(from_attributes=True)


class QuestionWithOptionsAndAnswerKey(QuestionRead):
    options: List[OptionRead]
    answer_key: AnswerKeyRead | None
    explanations: List[ExplanationRead] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)
