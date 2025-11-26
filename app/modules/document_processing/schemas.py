"""Pydantic models for the document processing API."""

from __future__ import annotations
from typing import List
from datetime import datetime
from pydantic import BaseModel, ConfigDict

class SectionOut(BaseModel):
    id: int
    heading: str | None = None
    content: str
    order_index: int

    model_config = ConfigDict(from_attributes=True)

class DocumentOut(BaseModel):
    id: int
    title: str
    clean_text_preview: str
    created_at: datetime
    sections: List[SectionOut]

    model_config = ConfigDict(from_attributes=True)