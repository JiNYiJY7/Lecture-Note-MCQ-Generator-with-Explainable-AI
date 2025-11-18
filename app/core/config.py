"""Application configuration helpers."""

from __future__ import annotations

import os
from pydantic import BaseModel


class Settings(BaseModel):
    """Lightweight settings object that can be extended later."""

    app_name: str = "Lecture Note MCQ Generator API"
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./mcq.db")
    debug: bool = os.getenv("DEBUG", "0") == "1"


settings = Settings()


