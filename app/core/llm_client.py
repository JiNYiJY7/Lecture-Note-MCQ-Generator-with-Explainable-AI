"""
LLM Client: Strict Mode.
Does NOT auto-switch between models. If the caller asks for DeepSeek, it tries DeepSeek.
"""
import os
from litellm import completion

# Default Models
ONLINE_MODEL = "deepseek/deepseek-chat"
OFFLINE_MODEL = "ollama/llama3.2:1b"


def check_deepseek_key() -> bool:
    """Returns True if the DeepSeek API key is present."""
    key = os.getenv("DEEPSEEK_API_KEY")
    return bool(key and key.strip())


def call_deepseek_chat(system_instruction: str, user_message: str) -> str:
    """
    Strictly calls DeepSeek (Online).
    Used by agent_tools.py when use_offline=False.
    """
    api_key = os.getenv("DEEPSEEK_API_KEY")

    # 1. Fast Fail: Don't even try if no key
    if not api_key:
        print("   ⚠️ [Online] Call failed: DEEPSEEK_API_KEY is missing.")
        return "Error: DeepSeek API Key is missing. Please switch to Offline mode or add your key."

    try:
        print(f"   🌐 [Online] Connecting to {ONLINE_MODEL}...")
        response = completion(
            model=ONLINE_MODEL,
            messages=[
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": user_message}
            ],
            api_key=api_key,
            timeout=120
        )
        return response.choices[0].message.content or ""

    except Exception as e:
        print(f"   ❌ [Online] Error: {e}")
        return f"Error connecting to DeepSeek: {str(e)}"


def call_offline_llm(system_instruction: str, user_message: str) -> str:
    """
    Strictly calls Ollama (Offline).
    Used for direct calls if needed.
    """
    try:
        print(f"   💻 [Offline] Connecting to {OFFLINE_MODEL}...")
        response = completion(
            model=OFFLINE_MODEL,
            messages=[
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": user_message}
            ],
            api_base="http://localhost:11434",
            timeout=120
        )
        return response.choices[0].message.content or ""

    except Exception as e:
        print(f"   ❌ [Offline] Error: {e}")
        return f"Error connecting to Local Ollama: {str(e)}"