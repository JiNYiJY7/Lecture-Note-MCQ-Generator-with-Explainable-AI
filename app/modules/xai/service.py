# app/modules/xai/service.py
"""
XAI service (DB-mode / stateless):
- Loads question bundle from SQLAlchemy models (DB mode)
- Generates FULL-SENTENCE explanation (2–4 sentences)
- Evidence retrieval is available (TF-IDF), appended only when include_evidence=True
"""

from __future__ import annotations

import re
from typing import List, Tuple, Set

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
# Helpers
# ---------------------------------------------------------------------------

def _question_kind(stem: str) -> str:
    s = (stem or "").strip().lower()
    if s.startswith("what is") or s.startswith("what are") or "definition" in s:
        return "definition"
    if "purpose" in s or "used for" in s:
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


_BASIC_STOPWORDS: Set[str] = {
    "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with", "by", "as",
    "is", "are", "was", "were", "be", "been", "being", "this", "that", "these", "those",
    "which", "what", "why", "how", "when", "where", "who", "whom", "it", "its",
    "use", "uses", "used", "using", "technique", "method", "approach", "context"
}


def _tokenize_keywords(text: str) -> List[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z\-']+", (text or "").lower())
    tokens = [t for t in tokens if len(t) >= 3 and t not in _BASIC_STOPWORDS]
    return tokens


def _top_overlaps(a: str, b: str, top_k: int = 6) -> List[str]:
    a_set = set(_tokenize_keywords(a))
    b_set = set(_tokenize_keywords(b))
    overlap = [t for t in a_set.intersection(b_set)]

    a_tokens = _tokenize_keywords(a)
    ordered: List[str] = []
    for t in a_tokens:
        if t in overlap and t not in ordered:
            ordered.append(t)
    return ordered[:top_k]


def _short_quote(text: str, max_len: int = 140) -> str:
    t = (text or "").strip().replace("\n", " ")
    if len(t) <= max_len:
        return t
    return t[: max_len - 1].rstrip() + "…"


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
# Main explanation builder (FULL SENTENCES)
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
    Output style (STRICT):
    - 2–4 complete sentences (no bullet points)
    - First sentence always: "Correct/Incorrect. The correct answer is X."
    - If lecture_text is missing, still explain using question/option keywords.
    """
    is_correct = (student_label == correct_label)

    label_to_text = {o.label: o.text for o in options}
    student_text = (label_to_text.get(student_label) or "").strip()
    correct_text = (label_to_text.get(correct_label) or "").strip()

    # Sentence 1 (verdict)
    s1 = f"{'Correct' if is_correct else 'Incorrect'}. The correct answer is {correct_label}."

    # If label mismatch, still produce full-sentence explanation
    if not student_text:
        s2 = (
            "I could not match your selected option label to an option text, "
            "so I cannot compare your choice precisely."
        )
        s3 = f'The correct option {correct_label} states: "{_short_quote(correct_text)}".'
        sentences = [s1, s2, s3]

        evidence: List[str] = []
        if include_evidence:
            query_text = f"{question_stem}\nCorrect answer: {correct_text}"
            evidence = retrieve_evidence(lecture_text, query_text, top_k=3)
            if evidence:
                sentences.append(
                    "For example, your notes support this by stating: "
                    + "; ".join([f'"{_short_quote(e, 120)}"' for e in evidence])
                    + "."
                )
            else:
                sentences.append("I could not find a strongly matching sentence in your notes for this stem.")

        reasoning = " ".join([s.strip() for s in sentences if s and s.strip()]).strip()
        return xai_schemas.XAIExplanationResponse(
            is_correct=is_correct,
            student_label=student_label,
            correct_label=correct_label,
            reasoning=reasoning,
            key_concepts=evidence[:3] if include_evidence else [],
            review_topics=["Review the definition/idea and compare it to the correct option."],
        )

    kind = _question_kind(question_stem)

    # Transparent keyword overlaps
    q_vs_correct = _top_overlaps(question_stem, correct_text, top_k=6)
    q_vs_student = _top_overlaps(question_stem, student_text, top_k=6)

    # Sentence 2: what the question is testing
    if kind == "definition":
        s2 = "This question is asking for the correct definition of the concept described in the stem."
    elif kind == "purpose":
        s2 = "This question is asking what the concept is used for in practice."
    elif kind == "effect":
        s2 = "This question is asking about the effect or outcome caused by the concept."
    elif kind == "advantage":
        s2 = "This question is asking for the main advantage or benefit of the concept."
    elif kind == "comparison":
        s2 = "This question is asking you to compare closely related ideas and choose the one that matches the stem."
    else:
        s2 = "This question is testing the key concept described by the stem."

    sentences: List[str] = [s1, s2]

    if is_correct:
        if q_vs_correct:
            sentences.append(
                f'Your choice matches the stem keywords ({", ".join(q_vs_correct)}), '
                f'which aligns with option {correct_label}: "{_short_quote(correct_text)}".'
            )
        else:
            sentences.append(
                f'Your choice matches the intended meaning of the stem, '
                f'which is captured by option {correct_label}: "{_short_quote(correct_text)}".'
            )
    else:
        correct_kw = ", ".join(q_vs_correct) if q_vs_correct else "the key terms in the stem"
        student_kw = ", ".join(q_vs_student) if q_vs_student else "different terms than the stem"

        if _is_benefit_style(student_text) and kind in {"definition", "purpose", "effect"}:
            sentences.append(
                f'Your option focuses on a benefit/result idea, but the stem is targeting {correct_kw}, '
                f'which is why option {correct_label} ("{_short_quote(correct_text)}") is the best match.'
            )
        else:
            sentences.append(
                f'Your option emphasizes {student_kw}, but the stem points to {correct_kw}, '
                f'which is why option {correct_label} ("{_short_quote(correct_text)}") is correct.'
            )

        sentences.append(
            f'In short, option {student_label} ("{_short_quote(student_text)}") does not answer what the stem asks, '
            f'while option {correct_label} directly addresses it.'
        )

    evidence: List[str] = []
    if include_evidence:
        query_text = f"{question_stem}\nCorrect answer: {correct_text}"
        evidence = retrieve_evidence(lecture_text, query_text, top_k=3)
        if evidence:
            sentences.append(
                "For example, your notes support this by stating: "
                + "; ".join([f'"{_short_quote(e, 120)}"' for e in evidence])
                + "."
            )
        else:
            sentences.append("I could not find a strongly matching sentence in your notes for this stem.")

    reasoning_text = " ".join([s.strip() for s in sentences if s and s.strip()]).strip()

    return xai_schemas.XAIExplanationResponse(
        is_correct=is_correct,
        student_label=student_label,
        correct_label=correct_label,
        reasoning=reasoning_text,
        key_concepts=evidence[:3] if include_evidence else [],
        review_topics=["Review the definition/idea and compare it to the correct option."],
    )
