"""XAI logic: TF-IDF retrieval + Hybrid AI explanation + Rule-based fallback."""

from __future__ import annotations

import re
from typing import List, Tuple
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sqlalchemy.orm import Session, joinedload

from app.modules.xai import schemas as xai_schemas
from app.modules.mcq_management import models as mcq_models

# --- IMPORTS ---
# Use the hybrid wrapper from llm_client
from app.core.llm_client import call_deepseek_reasoner

# ---------------------------------------------------------------------------
# Core Service Function
# ---------------------------------------------------------------------------

def build_explanation(
    lecture_text: str,
    question_stem: str,
    options: List[xai_schemas.XAIOption],
    correct_label: str,
    student_label: str,
) -> xai_schemas.XAIExplanationResponse:
    """
    Core XAI pipeline with 3 Layers of Redundancy:
    1. Retrieval: Local TF-IDF (Always works).
    2. Generation: Hybrid AI (DeepSeek -> Ollama).
    3. Fallback: Rule-Based Stitching (If AIs fail).
    """
    is_correct = (student_label == correct_label)

    # Helper: Map labels to text
    label_to_text = {o.label: o.text for o in options}
    student_text = label_to_text.get(student_label, "")
    correct_text = label_to_text.get(correct_label, "")

    # 1. RETRIEVE EVIDENCE (Local, No Internet needed)
    # We include the correct answer text in query to find relevant lecture parts
    query_text = f"{question_stem}\nCorrect answer: {correct_text}"

    # Call the function defined at the bottom of this file
    evidence = retrieve_evidence(lecture_text, query_text, top_k=3)

    # Build context for the AI
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

    # 2. HYBRID AI GENERATION
    reasoning_text = ""

    # Prompts designed for the 'reasoner' or 'smart' model
    system_prompt = (
        "You are an XAI tutor. Explain the answer using the provided evidence. "
        "Be concise (maximum 2 sentences). Direct tone."
    )

    user_prompt = (
        "Here is the context:\n"
        f"{context_block}\n\n"
        "Explain why the student is correct or incorrect based on the evidence."
    )

    try:
        # This calls the wrapper in llm_client.py
        # It tries DeepSeek -> Fails -> Tries Ollama -> Fails -> Returns ""
        reasoning_text = call_deepseek_reasoner(system_prompt, user_prompt)
    except Exception as e:
        print(f"Service Warning: AI call error: {e}")
        reasoning_text = ""

    # 3. RULE-BASED FALLBACK (Safety Net)
    # If reasoning_text is empty (meaning both DeepSeek and Ollama failed/crashed),
    # we manually stitch the evidence together.
    if not reasoning_text:
        print("   ⚠️ SYSTEM: Using Rule-Based Fallback (AI Unavailable)")
        if evidence:
            joined_evidence = " ".join([f"'{s}'" for s in evidence])
            if is_correct:
                reasoning_text = (
                    f"Correct. The lecture states: {joined_evidence} "
                    "This supports your answer."
                )
            else:
                reasoning_text = (
                    f"Incorrect. The lecture notes state: {joined_evidence} "
                    f"Therefore, the correct answer is {correct_label}."
                )
        else:
            reasoning_text = (
                f"Your answer is {'correct' if is_correct else 'incorrect'}. "
                f"The correct option is {correct_label}. (No specific evidence found in notes)."
            )

    # 4. Return Result
    return xai_schemas.XAIExplanationResponse(
        is_correct=is_correct,
        student_label=student_label,
        correct_label=correct_label,
        reasoning=reasoning_text,
        key_concepts=evidence[:3],
        review_topics=["Review the retrieved evidence sentences."]
    )

# ---------------------------------------------------------------------------
# Evidence Retrieval Logic
# ---------------------------------------------------------------------------

def retrieve_evidence(lecture_text: str, query: str, top_k: int = 3) -> List[str]:
    """
    TF-IDF based retrieval of relevant sentences from lecture text.
    """
    if not lecture_text:
        return []

    # Simple sentence splitting
    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', lecture_text) if len(s) > 20]
    if not sentences:
        return []

    # Add query to corpus to fit vectorizer
    corpus = sentences + [query]

    try:
        vectorizer = TfidfVectorizer(stop_words='english')
        tfidf_matrix = vectorizer.fit_transform(corpus)

        # Calculate cosine similarity between query (last item) and all sentences
        cosine_similarities = (tfidf_matrix[-1] * tfidf_matrix[:-1].T).toarray()[0]

        # Get top_k indices
        top_indices = cosine_similarities.argsort()[-top_k:][::-1]

        results = []
        for idx in top_indices:
            if cosine_similarities[idx] > 0.1: # Threshold to ignore irrelevant noise
                results.append(sentences[idx])

        return results
    except Exception as e:
        print(f"Retrieval Error: {e}")
        return []