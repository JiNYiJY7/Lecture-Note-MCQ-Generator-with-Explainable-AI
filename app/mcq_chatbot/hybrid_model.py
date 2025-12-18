from google.adk.models import Model
from litellm import completion
import os

class HybridModel(Model):
    def __init__(self, online_model="deepseek/deepseek-chat", offline_model="ollama/llama3.2"):
        self.online_model = online_model
        self.offline_model = offline_model

    def run(self, messages, **kwargs):
        """Synchronous run (if needed)"""
        # (Simplified logic similar to async below)
        pass

    async def run_async(self, messages, **kwargs):
        """
        The main function the Agent calls to get a response.
        """
        # Convert ADK messages to standard OpenAI format
        # (ADK messages structure might vary, strictly we map 'role' and 'content')
        formatted_msgs = [{"role": m.role, "content": m.content} for m in messages]

        # 1. Try Online
        try:
            if os.getenv("DEEPSEEK_API_KEY"):
                response = await completion(
                    model=self.online_model,
                    messages=formatted_msgs,
                    timeout=8,
                    stream=False
                    # Note: Streaming is harder to hybridize, easier to disable for safety
                )
                # Return plain text wrapped in an object ADK expects
                return MockResponse(response.choices[0].message.content)
        except Exception:
            pass # Fail silently to try offline

        # 2. Try Offline
        try:
            response = await completion(
                model=self.offline_model,
                messages=formatted_msgs,
                api_base="http://localhost:11434",
                timeout=40
            )
            return MockResponse(response.choices[0].message.content)
        except Exception as e:
            return MockResponse("System Error: Both Online and Offline AI are unavailable.")

class MockResponse:
    """Helper to mimic the object ADK expects back"""
    def __init__(self, text):
        self.text = text
    # You might need to adjust this depending on exactly what ADK's 'Model' class expects as a return type
    # For many simple ADK agents, returning a string or an object with .text works.