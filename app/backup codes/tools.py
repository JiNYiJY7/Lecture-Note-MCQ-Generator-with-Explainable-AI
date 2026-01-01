"""
Tool functions for the MCQ chatbot (demo version).

- In-memory state (simple + works for CLI demo)
- Later you can replace with DB/Redis + your real MCQ & XAI pipelines
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class _ChatState:
    lecture_id: Optional[str] = None
    lecture_title: Optional[str] = None
    lecture_text: Optional[str] = None
    last_questions: List[Dict[str, Any]] = field(default_factory=list)

    # response length preference
    verbosity: str = "short"  # short | normal | deep


_STATE = _ChatState()


def get_status() -> dict:
    """Return current state summary (safe to expose)."""
    return {
        "status": "success",
        "lecture_loaded": bool(_STATE.lecture_text),
        "lecture_id": _STATE.lecture_id,
        "lecture_title": _STATE.lecture_title,
        "has_last_questions": bool(_STATE.last_questions),
        "verbosity": _STATE.verbosity,
    }


def set_verbosity(level: str = "short") -> dict:
    """
    Set response verbosity preference.
    level: short | normal | deep
    """
    lv = (level or "").strip().lower()
    if lv not in {"short", "normal", "deep"}:
        return {"status": "error", "error_message": "level must be: short | normal | deep"}

    _STATE.verbosity = lv
    return {"status": "success", "verbosity": lv}


def load_lecture_text(text: str, title: str = "Untitled Lecture") -> dict:
    """
    Load lecture note text into the chatbot session.
    """
    if not text or len(text.strip()) < 50:
        return {
            "status": "error",
            "error_message": "Lecture text too short. Please paste more content (>= 50 characters).",
        }

    _STATE.lecture_id = "lec_001"
    _STATE.lecture_title = title.strip() if title else "Untitled Lecture"
    _STATE.lecture_text = text.strip()
    _STATE.last_questions = []

    return {
        "status": "success",
        "lecture_id": _STATE.lecture_id,
        "title": _STATE.lecture_title,
        "message": "Lecture loaded.",
    }


def highlight_key_points(top_k: int = 8) -> dict:
    """
    Text-based 'highlight': returns important sentences/snippets + approximate positions.

    Note: This is NOT visual highlighting. It returns snippets + start/end character offsets.
    """
    if not _STATE.lecture_text:
        return {"status": "error", "error_message": "No lecture loaded yet. Paste lecture text first."}

    text = _STATE.lecture_text
    top_k = int(top_k)
    top_k = max(1, min(top_k, 20))

    # Simple sentence split
    sents = re.split(r"(?<=[.!?])\s+|\n+", text)
    sents = [s.strip() for s in sents if len(s.strip()) >= 30]

    if not sents:
        return {"status": "error", "error_message": "No usable sentences found to highlight."}

    # Demo heuristic scoring (replace later with TF-IDF / embeddings)
    keywords = [
        "definition", "define", "important", "key", "therefore", "because",
        "means", "is called", "in summary", "must", "should", "formula"
    ]

    def score(s: str) -> float:
        low = s.lower()
        k = sum(1 for w in keywords if w in low)
        # slight bonus for patterns like "X is ..."
        pattern_bonus = 1.0 if re.search(r"\bis\b|\bare\b|\brefers to\b", low) else 0.0
        return k * 2.0 + pattern_bonus

    ranked = sorted(sents, key=score, reverse=True)[:top_k]

    highlights: List[Dict[str, Any]] = []
    for rs in ranked:
        idx = text.find(rs)
        highlights.append({
            "snippet": rs[:300],
            "start_char": idx if idx >= 0 else None,
            "end_char": (idx + len(rs)) if idx >= 0 else None,
            "reason": "High-signal sentence (demo heuristic).",
        })

    return {"status": "success", "top_k": len(highlights), "highlights": highlights}


def generate_mcq(n: int = 5, difficulty: str = "medium") -> dict:
    """
    Generate MCQs based on the loaded lecture.
    Demo placeholder. Replace with your real generator.
    """
    if not _STATE.lecture_text:
        return {
            "status": "error",
            "error_message": "No lecture loaded yet. Please provide lecture text first.",
        }

    n = int(n)
    if n <= 0 or n > 50:
        return {"status": "error", "error_message": "n must be between 1 and 50."}

    difficulty = (difficulty or "medium").strip().lower()
    if difficulty not in {"easy", "medium", "hard"}:
        difficulty = "medium"

    # TODO: Replace with DeepSeek Chat generation for real MCQs
    questions = []
    for i in range(1, n + 1):
        questions.append(
            {
                "qid": f"Q{i}",
                "question": f"(Demo) Question {i} from '{_STATE.lecture_title}' ({difficulty})?",
                "options": {"A": "Option A", "B": "Option B", "C": "Option C", "D": "Option D"},
                "answer": "B",
            }
        )

    _STATE.last_questions = questions

    return {
        "status": "success",
        "lecture_id": _STATE.lecture_id,
        "num_questions": n,
        "difficulty": difficulty,
        "questions": questions,
    }


def explain_answer(qid: str, user_answer: str) -> dict:
    """
    Explain why an answer is correct/incorrect with evidence.
    Demo evidence placeholder.
    """
    if not _STATE.last_questions:
        return {
            "status": "error",
            "error_message": "No recent questions found. Please generate MCQs first.",
        }

    qid_norm = (qid or "").strip().lower()
    q = next((x for x in _STATE.last_questions if str(x.get("qid", "")).lower() == qid_norm), None)
    if not q:
        return {"status": "error", "error_message": f"Question '{qid}' not found."}

    ua = (user_answer or "").strip().upper()
    correct = ua == q["answer"]

    evidence = [
        {"chunk_id": 3, "quote": "(Demo evidence) Replace this with real lecture snippet + location."}
    ]

    return {
        "status": "success",
        "qid": q["qid"],
        "user_answer": ua,
        "correct_answer": q["answer"],
        "is_correct": correct,
        "explanation": "Correct ✅ (demo)." if correct else "Not quite ❌ (demo).",
        "evidence": evidence,
        "topic_suggestions": ["Topic A", "Topic B"],
    }


def topic_review() -> dict:
    """
    Suggest what to review based on recent interaction.
    Demo placeholder.
    """
    if not _STATE.lecture_text:
        return {"status": "error", "error_message": "No lecture loaded yet."}

    return {
        "status": "success",
        "review_plan": [
            {"topic": "Topic A", "why": "Common misconception found in answers", "where": {"chunk_id": 3}},
            {"topic": "Topic B", "why": "Important definition frequently tested", "where": {"chunk_id": 7}},
        ],
    }
