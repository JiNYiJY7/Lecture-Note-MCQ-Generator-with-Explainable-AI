"""FastAPI router exposing the document processing workflow."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.document_processing import schemas, service

router = APIRouter(prefix="/document", tags=["Document Processing"])


@router.post("/process", response_model=schemas.DocumentOut)
def process_document(payload: schemas.DocumentIn, db: Session = Depends(get_db)):
    """
    Clean raw lecture text and break it into sections.

    Designed so that future PDF/DOCX parsers can feed into the same API
    without changing the frontend contract.
    """

    return service.process_lecture(db=db, title=payload.title, raw_text=payload.raw_text)


