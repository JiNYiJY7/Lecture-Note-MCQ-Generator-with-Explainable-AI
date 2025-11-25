"""Business logic for cleaning raw lecture text."""

from __future__ import annotations

import re
import fitz  # PyMuPDF
from typing import List

from sqlalchemy.orm import Session
from fastapi import UploadFile, HTTPException

from app.modules.mcq_management import models as mcq_models

def normalize_whitespace(text: str) -> str:
    """Collapse repeated whitespace and trim the text."""
    return re.sub(r"\s+", " ", text).strip()

def chunk_into_sections(clean_text: str) -> List[str]:
    """Split a cleaned lecture into pseudo-sections using blank lines."""
    paragraphs = [p.strip() for p in clean_text.split("\n\n") if p.strip()]
    return paragraphs or [clean_text]

async def process_upload(db: Session, file: UploadFile) -> mcq_models.Lecture:
    """Reads a file, persists a lecture + sections, and returns the object."""

    # 1. Read Content
    content = await file.read()
    raw_text = ""

    if file.content_type == "application/pdf":
        try:
            with fitz.open(stream=content, filetype="pdf") as doc:
                for page in doc:
                    raw_text += page.get_text() + "\n\n"
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid PDF file: {str(e)}")

    elif "text" in file.content_type:
        try:
            raw_text = content.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="Invalid text encoding (must be UTF-8)")
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    if not raw_text.strip():
        raise HTTPException(status_code=400, detail="File is empty or text could not be extracted")

    # 2. Process Text
    clean_text = normalize_whitespace(raw_text)
    section_texts = chunk_into_sections(raw_text.strip())

    # 3. Save Lecture
    lecture = mcq_models.Lecture(
        title=file.filename,
        raw_text=raw_text,
        clean_text=clean_text
    )
    db.add(lecture)
    db.flush()  # obtain PK for relationships

    # 4. Save Sections
    for index, paragraph in enumerate(section_texts, start=1):
        section = mcq_models.Section(
            lecture_id=lecture.id,
            heading=f"Section {index}",
            content=paragraph,
            order_index=index,
        )
        db.add(section)

    db.commit()
    db.refresh(lecture)

    return lecture