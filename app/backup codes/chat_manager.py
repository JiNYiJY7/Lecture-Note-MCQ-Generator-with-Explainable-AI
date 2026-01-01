import re

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.mcq_chatbot.agent import root_agent

SYSTEM_HINT = """
SYSTEM: CRITICAL INSTRUCTIONS FOR ANSWER CHECKING
- When user asks about an MCQ answer (any mention of checking/correct/incorrect/option), you MUST:
  1. Immediately call explain_mcq_answer_tool with ONLY question_id and student_answer_label
  2. Output the tool's response EXACTLY as is - NO extra text
  3. DO NOT comment, explain, or add any words before/after
  4. DO NOT ask for more information - the tool fetches everything automatically

Example user messages that require tool use:
- "Is option A correct?"
- "Check my answer"
- "I choose option B"
- "Please check option C"
- Any message with "option" and a letter

YOU MUST BE SILENT - just call the tool and output its response.
"""

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

        is_answer_check = any(keyword in user_msg.lower() for keyword in [
            "option", "check", "correct", "incorrect", "choose", "selected",
            "answer", "a?", "b?", "c?", "d?", "is this"
        ])

        if is_answer_check:
            # Force tool use with system hint
            wrapped_msg = f"{SYSTEM_HINT}\n\nUSER: {user_msg}"
        else:
            wrapped_msg = user_msg

        content = types.Content(role="user", parts=[types.Part(text=wrapped_msg)])
        final_text = ""

        # Run the agent
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