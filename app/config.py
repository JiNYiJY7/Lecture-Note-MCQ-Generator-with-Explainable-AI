"""Central configuration objects for Flask + extensions."""

from __future__ import annotations

from pathlib import Path


class Config:
    """Simple config class that is easy to describe in reports."""

    BASE_DIR = Path(__file__).resolve().parent
    SECRET_KEY = "dev-secret-placeholder"
    SQLALCHEMY_DATABASE_URI = "sqlite:///" + str(BASE_DIR / "mcq.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
