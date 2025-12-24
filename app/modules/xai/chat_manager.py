import re

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.mcq_chatbot.agent import root_agent


SYSTEM_HINT = """
SYSTEM: Important rule for tutoring
- Do NOT ask the user to provide lecture text, question stem, or options.
- If the user is answering an MCQ, you MUST call explain_mcq_answer_tool using ONLY:
  question_id (int) and student_answer_label (A/B/C/D).
- The tool will retrieve the latest lecture note and question data from the database automatically.
- If a tool call fails, retry by calling the tool again with only question_id and student_answer_label (no extra fields).
""".strip()


class ChatManager:
    def __init__(self):
        self.app_name = "mcq_chatbot_api"
        self.session_service = InMemorySessionService()

        self.runner = Runner(
            agent=root_agent,
            app_name=self.app_name,
            session_service=self.session_service,
        )

    async def send_message(self, session_id: str, user_msg: str, user_id: str = "default_user") -> str:
        """
        Sends a message to the agent and awaits the final response.
        """
        # 1) Create session if it doesn't exist (safe to call multiple times)
        try:
            await self.session_service.create_session(
                app_name=self.app_name,
                user_id=user_id,
                session_id=session_id
            )
        except Exception:
            pass

        # 2) Inject a system hint to reduce "please provide lecture text" replies
        # We keep it as part of user text because ADK event input here is a user Content.
        wrapped_user_msg = f"{SYSTEM_HINT}\n\nUSER: {user_msg}"

        content = types.Content(role="user", parts=[types.Part(text=wrapped_user_msg)])
        final_text = ""

        # 3) Run the agent
        async for event in self.runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=content
        ):
            if event.is_final_response():
                if event.content and event.content.parts:
                    final_text = event.content.parts[0].text or ""
                elif getattr(event, "error_message", None):
                    final_text = f"[ERROR] {event.error_message}"
                break

        return final_text or "[No response generated]"


chat_manager = ChatManager()
