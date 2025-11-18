from __future__ import annotations

import os
import httpx


class DeepSeekError(Exception):
    """Custom exception for DeepSeek-related errors."""


def _get_api_key() -> str:
    """
    Read DEEPSEEK_API_KEY from environment variables every time.
    """
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise DeepSeekError("DEEPSEEK_API_KEY environment variable is not set.")
    return api_key


DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1/chat/completions"


def call_deepseek(
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.7,
) -> str:
    """
    Low-level DeepSeek chat completion call.
    """
    api_key = _get_api_key()

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    with httpx.Client(timeout=60.0) as client:
        resp = client.post(DEEPSEEK_BASE_URL, json=payload, headers=headers)
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise DeepSeekError(f"DeepSeek API error: {exc.response.text}") from exc

    data = resp.json()
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as exc:
        raise DeepSeekError(f"Unexpected DeepSeek response format: {data}") from exc


def call_deepseek_chat(system_prompt: str, user_prompt: str) -> str:
    """Wrapper for MCQ generation."""
    return call_deepseek(
        model="deepseek-chat",
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=0.7,
    )


def call_deepseek_reasoner(system_prompt: str, user_prompt: str) -> str:
    """Wrapper for reasoning / XAI."""
    return call_deepseek(
        model="deepseek-reasoner",
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=0.3,
    )
