"""FastAPI router exposing the document processing workflow."""

from __future__ import annotations

from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.document_processing import schemas, service

router = APIRouter(prefix="/documents", tags=["Document Processing"])

@router.post("/upload", response_model=schemas.DocumentOut)
async def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Upload a PDF or TXT file.
    It extracts text, cleans it, chunks it into sections, and saves it to the DB.
    """
    lecture = await service.process_upload(db=db, file=file)

    # Construct response manually to match schema (or let Pydantic handle it via ORM)
    return schemas.DocumentOut(
        id=lecture.id,
        title=lecture.title,
        clean_text_preview=lecture.clean_text[:200] + "...",
        created_at=lecture.created_at,
        sections=lecture.sections
    )