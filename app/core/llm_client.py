from __future__ import annotations

import os
import httpx

# Configuration
DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1/chat/completions"
OLLAMA_BASE_URL = "http://localhost:11434/api/generate"  # Standard Ollama endpoint
OFFLINE_MODEL = "llama3.2"  # Make sure you ran `ollama run llama3.2`


class LLMError(Exception):
    """Custom exception for LLM-related errors."""


def _get_deepseek_key() -> str | None:
    """Read API Key safely. Returns None if missing (triggers offline mode)."""
    return os.getenv("DEEPSEEK_API_KEY")


# ---------------------------------------------------------------------------
# 1. ONLINE CLIENT (DeepSeek)
# ---------------------------------------------------------------------------
def _call_deepseek_raw(model: str, system_prompt: str, user_prompt: str, temperature: float) -> str:
    api_key = _get_deepseek_key()
    if not api_key:
        raise LLMError("No DeepSeek API Key found.")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
    }

    # Short timeout (10s) so we fail over to offline quickly if internet is bad
    with httpx.Client(timeout=10.0) as client:
        resp = client.post(DEEPSEEK_BASE_URL, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


# ---------------------------------------------------------------------------
# 2. OFFLINE CLIENT (Ollama)
# ---------------------------------------------------------------------------
def _call_ollama_raw(system_prompt: str, user_prompt: str, temperature: float) -> str:
    """
    Calls local Ollama.
    Note: Ollama's /api/generate endpoint uses a slightly different JSON format
    than OpenAI/DeepSeek (unless using their compatibility endpoint).
    """
    # Combine prompts because basic Ollama usually takes a single prompt block
    full_prompt = f"System: {system_prompt}\n\nUser: {user_prompt}\n\nAssistant:"

    payload = {
        "model": OFFLINE_MODEL,
        "prompt": full_prompt,
        "stream": False,
        "options": {
            "temperature": temperature
        }
    }

    # Longer timeout (45s) because local CPU inference can be slower
    with httpx.Client(timeout=45.0) as client:
        resp = client.post(OLLAMA_BASE_URL, json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data.get("response", "")


# ---------------------------------------------------------------------------
# 3. HYBRID ORCHESTRATOR
# ---------------------------------------------------------------------------
def call_hybrid_llm(
        online_model: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7
) -> str:
    """
    Tries Online (DeepSeek) first.
    If it fails (Network, Auth, Timeout), falls back to Offline (Ollama).
    """
    # --- ATTEMPT 1: ONLINE ---
    try:
        print(f"   🌐 [Hybrid] Connecting to DeepSeek ({online_model})...")
        return _call_deepseek_raw(online_model, system_prompt, user_prompt, temperature)

    except Exception as e:
        print(f"   ⚠️ [Hybrid] Online failed ({str(e)}). Switching to Offline...")

    # --- ATTEMPT 2: OFFLINE ---
    try:
        print(f"   💻 [Hybrid] Connecting to Local Ollama ({OFFLINE_MODEL})...")
        return _call_ollama_raw(system_prompt, user_prompt, temperature)

    except Exception as e:
        print(f"   ❌ [Hybrid] Offline also failed: {str(e)}")
        # Return empty string so the service can use its rule-based backup
        return ""


# ---------------------------------------------------------------------------
# 4. WRAPPERS (Used by service.py / agent.py)
# ---------------------------------------------------------------------------

def call_deepseek_chat(system_prompt: str, user_prompt: str) -> str:
    """Used for MCQ Generation."""
    return call_hybrid_llm(
        online_model="deepseek-chat",
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=0.7
    )


def call_deepseek_reasoner(system_prompt: str, user_prompt: str) -> str:
    """Used for XAI Explanations."""
    return call_hybrid_llm(
        online_model="deepseek-reasoner",
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        temperature=0.3
    )