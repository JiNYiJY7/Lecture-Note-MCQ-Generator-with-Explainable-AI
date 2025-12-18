import os

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# Adjust this import to match where your 'root_agent' actually lives
# If you moved the folder to app/mcq_chatbot, this is correct:
from app.mcq_chatbot.agent import root_agent


class ChatManager:
    def __init__(self):
        self.app_name = "mcq_chatbot_api"
        # The service that holds conversation history in memory
        self.session_service = InMemorySessionService()

        # The runner that executes the agent
        self.runner = Runner(
            agent=root_agent,
            app_name=self.app_name,
            session_service=self.session_service,
        )

    async def send_message(self, session_id: str, user_msg: str, user_id: str = "default_user") -> str:
        """
        Sends a message to the agent and awaits the final response.
        """
        # 1. Create session if it doesn't exist (safe to call multiple times)
        try:
            await self.session_service.create_session(
                app_name=self.app_name,
                user_id=user_id,
                session_id=session_id
            )
        except Exception:
            pass  # Session likely already exists

        # 2. Prepare the user's message
        content = types.Content(role="user", parts=[types.Part(text=user_msg)])
        final_text = ""

        # 3. Run the agent and wait for the response
        async for event in self.runner.run_async(
                user_id=user_id,
                session_id=session_id,
                new_message=content
        ):
            # Check if this event contains the final answer
            if event.is_final_response():
                if event.content and event.content.parts:
                    final_text = event.content.parts[0].text or ""
                elif getattr(event, "error_message", None):
                    final_text = f"[ERROR] {event.error_message}"
                break

        return final_text or "[No response generated]"


# Create a single instance to be shared across the app
chat_manager = ChatManager()