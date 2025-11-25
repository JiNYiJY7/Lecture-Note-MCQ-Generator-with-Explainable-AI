"""XAI logic: TF-IDF retrieval + rule-based correctness + LLM explanation."""

from __future__ import annotations

import re
from typing import List, Tuple

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sqlalchemy.orm import Session, joinedload

from app.core.llm_client import call_deepseek_reasoner
from app.modules.xai import schemas as xai_schemas
from app.modules.mcq_management import models as mcq_models


# ---------------------------------------------------------------------------
# Helpers: DB loading (for question_id mode)
# ---------------------------------------------------------------------------


def load_question_bundle(db: Session, question_id: int) -> Tuple[str, str, List[xai_schemas.XAIOption], str]:
    """
    Load lecture text, question stem, options, and correct label from DB.

    Returns
    -------
    lecture_text : str
    stem         : str
    options      : list[XAIOption]
    correct_label: str
    """
    q = (
        db.query(mcq_models.Question)
        .options(
            joinedload(mcq_models.Question.options),
            joinedload(mcq_models.Question.answer_key).joinedload(mcq_models.AnswerKey.correct_option),
            joinedload(mcq_models.Question.lecture),
        )
        .filter(mcq_models.Question.id == question_id)
        .first()
    )

    if q is None:
        raise ValueError(f"Question with id={question_id} not found.")

    if not q.lecture:
        raise ValueError("Question has no linked lecture.")

    lecture_text = q.lecture.clean_text or ""
    stem = q.stem  # FIXED: used to be q.text

    opts = [
        xai_schemas.XAIOption(label=o.label, text=o.text)
        for o in sorted(q.options, key=lambda x: x.label)
    ]

    # FIXED: Access correct_option relationship
    correct_label = ""
    if q.answer_key and q.answer_key.correct_option:
        correct_label = q.answer_key.correct_option.label

    return lecture_text, stem, opts, correct_label


# ---------------------------------------------------------------------------
# TF-IDF retrieval: find evidence sentences from lecture text
# ---------------------------------------------------------------------------


def _split_into_sentences(text: str) -> List[str]:
    """Very light sentence splitter using punctuation and newlines."""
    raw = re.split(r"[.\n]+", text)
    return [s.strip() for s in raw if s.strip()]


def retrieve_evidence(lecture_text: str, query_text: str, top_k: int = 3) -> List[str]:
    """
    Use TF-IDF + cosine similarity to retrieve the most relevant sentences
    from the lecture text for the given query_text.
    """
    sentences = _split_into_sentences(lecture_text)
    if not sentences:
        return []

    # If corpus is too small, just return what we have
    if len(sentences) < top_k:
        return sentences

    corpus = sentences + [query_text]

    try:
        vectorizer = TfidfVectorizer()
        tfidf = vectorizer.fit_transform(corpus)

        query_vec = tfidf[-1]  # last row is the query
        doc_matrix = tfidf[:-1]

        # cosine similarity
        sims = (doc_matrix @ query_vec.T).toarray().ravel()

        # sort descending
        top_indices = np.argsort(sims)[::-1][:top_k]

        # only keep sentences with non-zero similarity
        return [sentences[i] for i in top_indices if sims[i] > 0]
    except ValueError:
        # Handle cases with empty vocabulary or stop words only
        return sentences[:top_k]


# ---------------------------------------------------------------------------
# Main explanation pipeline
# ---------------------------------------------------------------------------


def build_explanation(
    lecture_text: str,
    question_stem: str,
    options: List[xai_schemas.XAIOption],
    correct_label: str,
    student_label: str,
) -> xai_schemas.XAIExplanationResponse:
    """
    Core XAI pipeline:

    1. TF-IDF retrieval: find key sentences from the lecture related to the
       question + correct answer.
    2. Rule-based correctness: compare student_label vs correct_label.
    3. LLM (DeepSeek-Reasoner): turn the structured information into a
       natural-language explanation and suggest review topics.
    """
    is_correct = (student_label == correct_label)

    # Find text of student's choice / correct choice
    label_to_text = {o.label: o.text for o in options}
    student_text = label_to_text.get(student_label, "")
    correct_text = label_to_text.get(correct_label, "")

    query_text = f"{question_stem}\nCorrect answer: {correct_text}"
    evidence = retrieve_evidence(lecture_text, query_text, top_k=3)

    # Build a compact JSON-like context for the LLM
    context_block = {
        "question_stem": question_stem,
        "options": [{"label": o.label, "text": o.text} for o in options],
        "correct_label": correct_label,
        "correct_text": correct_text,
        "student_label": student_label,
        "student_text": student_text,
        "is_correct": is_correct,
        "evidence_sentences": evidence,
    }

    system_prompt = (
        "You are an Explainable AI (XAI) tutor for university students. "
        "Given a multiple-choice question, the student's answer, the correct "
        "answer, and some evidence sentences from the lecture note, you must "
        "produce a clear, concise explanation.\n\n"
        "- If the answer is correct: confirm it and briefly explain why.\n"
        "- If the answer is incorrect: explain why it is wrong, then explain "
        "the correct answer.\n"
        "- Finally, suggest 2-3 short topics the student should review.\n"
        "Answer in simple English, 2–4 short paragraphs, without repeating the "
        "full question text."
    )

    user_prompt = (
        "Here is the structured context in JSON form:\n"
        f"{context_block}\n\n"
        "1) First, give a short judgement (Correct / Incorrect).\n"
        "2) Then explain using the evidence sentences.\n"
        "3) End with a bullet list called 'Topics to review'."
    )

    try:
        reasoning_text = call_deepseek_reasoner(system_prompt, user_prompt)
    except Exception as e:
        print(f"LLM Error: {e}")
        # Fallback in case the LLM call fails
        base_msg = (
            f"Your answer is {'correct' if is_correct else 'incorrect'}. "
            f"The correct answer is {correct_label}: {correct_text}. "
            "Please review the lecture notes for more details."
        )
        reasoning_text = base_msg

    # In a real app, you might ask the LLM to output JSON to parse these out reliably
    # For now, we just reuse the evidence as the "key concepts"
    key_concepts = evidence[:3]
    review_topics = ["Review the retrieved evidence sentences above."]

    return xai_schemas.XAIExplanationResponse(
        is_correct=is_correct,
        student_label=student_label,
        correct_label=correct_label,
        reasoning=reasoning_text,
        key_concepts=key_concepts,
        review_topics=review_topics,
    )