from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.modules.mcq_management import service, schemas

router = APIRouter(prefix="/mcq", tags=["MCQ Generation"])


@router.post("/generate", response_model=schemas.MCQGenerationResponse)
def generate_mcq_api(
        payload: schemas.MCQGenerationRequest,
        db: Session = Depends(get_db)
):
    """
    Generate MCQs using Hybrid AI (Online DeepSeek or Offline Llama 3.2).
    """
    try:
        # ✅ Pass the 'use_offline' flag to the service
        result = service.generate_questions_via_agent(
            db=db,
            lecture_id=payload.lecture_id,
            num_questions=payload.num_questions,
            use_offline=payload.use_offline
        )
        return result

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        print(f"Generation Error: {e}")
        # If online fails, tell frontend (503) so it can suggest offline mode
        if not payload.use_offline and "503" in str(e):
            raise HTTPException(status_code=503, detail="Online Service Unavailable")

        raise HTTPException(status_code=500, detail=str(e))