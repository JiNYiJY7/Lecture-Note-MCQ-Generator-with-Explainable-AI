"""Business logic for cleaning raw lecture text."""

from __future__ import annotations

import re
from typing import List

from sqlalchemy.orm import Session

from app.modules.mcq_management import models as mcq_models


def normalize_whitespace(text: str) -> str:
    """Collapse repeated whitespace and trim the text."""

    return re.sub(r"\s+", " ", text).strip()


def chunk_into_sections(clean_text: str) -> List[str]:
    """Split a cleaned lecture into pseudo-sections using blank lines."""

    paragraphs = [p.strip() for p in clean_text.split("\n\n") if p.strip()]
    return paragraphs or [clean_text]


def process_lecture(db: Session, title: str, raw_text: str) -> dict:
    """Persist a lecture + sections and return a structured payload."""

    clean_text = normalize_whitespace(raw_text)
    section_texts = chunk_into_sections(raw_text.strip())

    lecture = mcq_models.Lecture(title=title, raw_text=raw_text, clean_text=clean_text)
    db.add(lecture)
    db.flush()  # obtain PK for relationships

    sections_out = []
    for index, paragraph in enumerate(section_texts, start=1):
        section = mcq_models.Section(
            lecture_id=lecture.id,
            heading=f"Section {index}",
            content=paragraph,
            order_index=index,
        )
        db.add(section)
        db.flush()
        sections_out.append(
            {
                "section_id": section.id,
                "heading": section.heading,
                "content": paragraph,
            }
        )

    db.commit()

    return {
        "lecture_id": lecture.id,
        "title": lecture.title,
        "sections": sections_out,
    }


