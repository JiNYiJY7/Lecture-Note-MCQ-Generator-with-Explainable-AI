"""
XAI service (DB-mode):
- Loads question bundle from your exact SQLAlchemy models
- Generates SHORT explanation (2–3 bullets)
- Evidence retrieval is available (TF-IDF), but only appended when include_evidence=True
"""

from __future__ import annotations

import re
from typing import List, Tuple

from sklearn.feature_extraction.text import TfidfVectorizer
from sqlalchemy.orm import Session, joinedload

from app.modules.xai import schemas as xai_schemas
from app.modules.mcq_management import models as mcq_models


# ---------------------------------------------------------------------------
# DB Loader (EXACT mapping to your models.py)
# ---------------------------------------------------------------------------

def load_question_bundle(
    db: Session,
    question_id: int,
) -> Tuple[str, str, List[xai_schemas.XAIOption], str]:
    """
    Loads:
      - lecture_text (prefer Lecture.clean_text)
      - stem (Question.stem)
      - options [{label,text}]
      - correct_label (AnswerKey.correct_option.label; fallback Option.is_correct)
    """
    q = (
        db.query(mcq_models.Question)
        .options(
            joinedload(mcq_models.Question.lecture),
            joinedload(mcq_models.Question.options),
            joinedload(mcq_models.Question.answer_key).joinedload(
                mcq_models.AnswerKey.correct_option
            ),
        )
        .filter(mcq_models.Question.id == question_id)
        .first()
    )

    if not q:
        raise ValueError(f"Question not found for question_id={question_id}")

    stem = (q.stem or "").strip()

    options = [
        xai_schemas.XAIOption(label=o.label, text=o.text)
        for o in (q.options or [])
    ]
    if not options:
        raise ValueError("This question has no options in DB.")

    # Correct label from AnswerKey -> correct_option -> label
    correct_label = ""
    if q.answer_key and q.answer_key.correct_option:
        correct_label = (q.answer_key.correct_option.label or "").strip()

    # Fallback: if any option has is_correct=True
    if not correct_label:
        for o in (q.options or []):
            if getattr(o, "is_correct", False):
                correct_label = (o.label or "").strip()
                break

    if not correct_label:
        raise ValueError(
            "Correct answer label not found. Ensure AnswerKey is stored and linked to options."
        )

    lecture_text = ""
    if q.lecture:
        lecture_text = (q.lecture.clean_text or q.lecture.raw_text or "").strip()

    return lecture_text, stem, options, correct_label


# ---------------------------------------------------------------------------
# Helpers (short, less robotic)
# ---------------------------------------------------------------------------

def _question_kind(stem: str) -> str:
    s = (stem or "").strip().lower()
    if s.startswith("what is") or s.startswith("what are") or "definition" in s:
        return "definition"
    if "purpose" in s:
        return "purpose"
    if "effect" in s or "impact" in s:
        return "effect"
    if "advantage" in s or "benefit" in s:
        return "advantage"
    if "difference" in s or "compare" in s:
        return "comparison"
    return "concept"


def _is_benefit_style(text: str) -> bool:
    t = (text or "").lower()
    return bool(
        re.search(
            r"\b(improve|improves|increase|accuracy|accurate|performance|better|results|efficient|faster)\b",
            t,
        )
    )


# ---------------------------------------------------------------------------
# Evidence retrieval (TF-IDF)
# ---------------------------------------------------------------------------

def retrieve_evidence(lecture_text: str, query: str, top_k: int = 3) -> List[str]:
    if not lecture_text:
        return []

    sentences = [
        s.strip()
        for s in re.split(r"(?<=[.!?])\s+", lecture_text)
        if len(s.strip()) > 20
    ]
    if not sentences:
        return []

    corpus = sentences + [query]

    try:
        vectorizer = TfidfVectorizer(stop_words="english")
        tfidf_matrix = vectorizer.fit_transform(corpus)
        cosine_similarities = (tfidf_matrix[-1] * tfidf_matrix[:-1].T).toarray()[0]
        top_indices = cosine_similarities.argsort()[-top_k:][::-1]

        results: List[str] = []
        for idx in top_indices:
            if cosine_similarities[idx] > 0.1:
                results.append(sentences[idx])
        return results
    except Exception as e:
        print(f"Retrieval Error: {e}")
        return []


# ---------------------------------------------------------------------------
# Main explanation builder
# ---------------------------------------------------------------------------

def build_explanation(
    lecture_text: str,
    question_stem: str,
    options: List[xai_schemas.XAIOption],
    correct_label: str,
    student_label: str,
    include_evidence: bool = False,
) -> xai_schemas.XAIExplanationResponse:
    """
    Output style:
    - 2–3 bullets max
    - Evidence is ONLY appended if include_evidence=True
    """
    is_correct = (student_label == correct_label)

    label_to_text = {o.label: o.text for o in options}
    student_text = (label_to_text.get(student_label) or "").strip()
    correct_text = (label_to_text.get(correct_label) or "").strip()

    kind = _question_kind(question_stem)

    # Verdict line (short & clear)
    if is_correct:
        header = f"Correct. The correct answer is {correct_label}."
    else:
        header = f"Incorrect. The correct answer is {correct_label}."

    bullets: List[str] = []

    # Bullet 1: what the question is testing (simple)
    if kind == "definition":
        bullets.append("This question is checking the definition.")
    elif kind == "purpose":
        bullets.append("This question is asking what it is used for.")
    elif kind == "effect":
        bullets.append("This question is asking what changes / what happens.")
    elif kind == "advantage":
        bullets.append("This question is asking for the main benefit.")
    elif kind == "comparison":
        bullets.append("This question is asking you to compare two ideas.")
    else:
        bullets.append("This question is testing the key concept.")

    # Bullet 2/3: short feedback
    if not student_text:
        bullets.append("I couldn’t read your selected option text (label mismatch).")
        bullets.append(f'Correct option {correct_label}: "{correct_text}".')
    else:
        if is_correct:
            bullets.append(f'Your choice matches the correct idea: "{correct_text}".')
            bullets.append('Ask "why" if you want 1–3 evidence lines from your notes.')
        else:
            if _is_benefit_style(student_text) and kind in {"definition", "purpose", "effect"}:
                bullets.append("Your option sounds like a benefit/result, but the question wants the core idea.")
            else:
                bullets.append("Your option answers a different angle than what the question is asking.")
            bullets.append(f'Correct option {correct_label}: "{correct_text}". (Ask "why" for note evidence.)')

    # Evidence only when requested
    evidence: List[str] = []
    if include_evidence:
        query_text = f"{question_stem}\nCorrect answer: {correct_text}"
        evidence = retrieve_evidence(lecture_text, query_text, top_k=3)

    # Reasoning string (keep compatible with your current UI)
    # IMPORTANT: Use newlines so frontend can render it as bullets if you enable pre-wrap.
    reasoning_lines = [header, "Because:"]
    reasoning_lines.extend([f"- {b}" for b in bullets[:3]])  # cap 2–3 bullets

    if include_evidence:
        reasoning_lines.append("Evidence:")
        if evidence:
            reasoning_lines.extend([f"- {s}" for s in evidence])
        else:
            reasoning_lines.append("- (No matching lecture sentence found.)")

    reasoning_text = "\n".join(reasoning_lines)

    # Return fields that your frontend currently uses: is_correct, correct_label, reasoning
    return xai_schemas.XAIExplanationResponse(
        is_correct=is_correct,
        student_label=student_label,
        correct_label=correct_label,
        reasoning=reasoning_text,
        key_concepts=evidence[:3] if include_evidence else [],
        review_topics=["Review the definition/idea and compare it to the correct option."],
    )
