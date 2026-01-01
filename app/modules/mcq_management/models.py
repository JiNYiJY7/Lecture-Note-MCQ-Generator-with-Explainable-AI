"""SQLAlchemy models for MCQ management."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Lecture(Base):
    """Represents a processed lecture ready for MCQ generation."""

    __tablename__ = "lectures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    clean_text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    sections: Mapped[list["Section"]] = relationship(
        back_populates="lecture", cascade="all, delete-orphan"
    )
    questions: Mapped[list["Question"]] = relationship(back_populates="lecture")


class Section(Base):
    """Logical sub-part of a lecture (paragraph, heading, etc.)."""

    __tablename__ = "sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lecture_id: Mapped[int] = mapped_column(ForeignKey("lectures.id"), nullable=False)
    heading: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)

    lecture: Mapped["Lecture"] = relationship(back_populates="sections")
    questions: Mapped[list["Question"]] = relationship(back_populates="section")


class Question(Base):
    """Stores the MCQ stem and metadata."""

    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lecture_id: Mapped[int] = mapped_column(ForeignKey("lectures.id"), nullable=False)
    section_id: Mapped[int | None] = mapped_column(ForeignKey("sections.id"), nullable=True)
    stem: Mapped[str] = mapped_column(Text, nullable=False)
    difficulty: Mapped[str | None] = mapped_column(String(50), default="medium")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    lecture: Mapped["Lecture"] = relationship(back_populates="questions")
    section: Mapped["Section"] = relationship(back_populates="questions")
    options: Mapped[list["Option"]] = relationship(
        back_populates="question", cascade="all, delete-orphan"
    )
    answer_key: Mapped["AnswerKey"] = relationship(
        back_populates="question", uselist=False, cascade="all, delete-orphan"
    )
    explanations: Mapped[list["Explanation"]] = relationship(
        back_populates="question", cascade="all, delete-orphan"
    )


class Option(Base):
    """Represents each answer option for a question."""

    __tablename__ = "options"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), nullable=False)
    label: Mapped[str] = mapped_column(String(5), nullable=False)
    text: Mapped[str] = mapped_column(String(512), nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)

    question: Mapped["Question"] = relationship(back_populates="options")


class AnswerKey(Base):
    """Tracks the canonical correct option."""

    __tablename__ = "answer_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[int] = mapped_column(
        ForeignKey("questions.id"), nullable=False, unique=True
    )
    correct_option_id: Mapped[int] = mapped_column(ForeignKey("options.id"), nullable=False)

    question: Mapped["Question"] = relationship(back_populates="answer_key")
    correct_option: Mapped["Option"] = relationship()


class Explanation(Base):
    """Stores XAI output (JSON serialized as text)."""

    __tablename__ = "explanations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    option_id = Column(Integer, ForeignKey("options.id"), nullable=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    question: Mapped["Question"] = relationship(back_populates="explanations")

