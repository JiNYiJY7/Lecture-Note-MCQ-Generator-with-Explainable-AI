"""Pydantic models for the document processing API."""

from __future__ import annotations

from typing import List

from pydantic import BaseModel


class DocumentIn(BaseModel):
    """Payload representing raw lecture text."""

    title: str
    raw_text: str


class SectionOut(BaseModel):
    section_id: int
    heading: str | None = None
    content: str


class DocumentOut(BaseModel):
    lecture_id: int
    title: str
    sections: List[SectionOut]


