"""FastAPI application entry point."""

from dotenv import load_dotenv
load_dotenv()  # Load environment variables from .env at startup

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.database import Base, engine
from app.modules.document_processing.router import router as document_router
from app.modules.mcq_generation.router import router as generation_router
from app.modules.mcq_management.router import router as management_router
from app.modules.xai.router import router as xai_router


# Create all database tables
Base.metadata.create_all(bind=engine)

# Initialize FastAPI app
app = FastAPI(
    title="Lecture Note MCQ Generator API",
    description="Workshop 2 backend that manages document processing, MCQ generation (DeepSeek), and XAI.",
    version="0.2.0",
)

# ---------- CORS config for React (Vite) frontend ----------
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,   
    allow_credentials=True,
    allow_methods=["*"],     
    allow_headers=["*"],
)
# ----------------------------------------------------------


# Register API routers
app.include_router(xai_router, prefix="/api")
app.include_router(document_router, prefix="/api")
app.include_router(management_router, prefix="/api")
app.include_router(generation_router, prefix="/api")

@app.get("/")
def root():
    """Health/status endpoint for quick checks."""
    return {
        "status": "ok",
        "message": "Lecture Note MCQ Generator backend is running.",
    }

