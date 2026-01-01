import re
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# Import both agents (Required for Online/Offline Toggle)
from app.mcq_chatbot.agent import online_agent, offline_agent
from app.modules.xai.agent_tools import explain_mcq_answer_tool


class ChatManager:
    def __init__(self):
        self.session_service = InMemorySessionService()

        # ✅ Initialize TWO runners with distinct app_names
        self.online_runner = Runner(
            agent=online_agent,
            app_name="online",  # Scope session to 'online'
            session_service=self.session_service
        )
        self.offline_runner = Runner(
            agent=offline_agent,
            app_name="offline",  # Scope session to 'offline'
            session_service=self.session_service
        )

    async def send_message(self, session_id: str, user_msg: str, user_id: str = "default_user",
                           use_offline: bool = False) -> str:
        """
        Sends a message to the agent, ensuring the session exists first.
        """

        # 1. Determine which Runner and App Name to use
        target_runner = self.offline_runner if use_offline else self.online_runner
        target_app_name = "offline" if use_offline else "online"

        # 2. ✅ CRITICAL FIX FROM BACKUP: Ensure session exists
        # This prevents "Session not found" errors after server restarts
        try:
            await self.session_service.create_session(
                app_name=target_app_name,
                user_id=user_id,
                session_id=session_id
            )
        except Exception:
            # Session likely already exists, which is fine
            pass

        # 3. 🛡️ INTERCEPTION: Handle "Check Answer" manually
        # This keeps the "Check Answer" button fast and reliable
        if "explain_mcq_answer_tool" in user_msg or "question ID is:" in user_msg:
            try:
                # Parse QID and Label from the prompt constructed by Frontend
                qid_match = re.search(r"question ID is: (\d+)", user_msg)
                label_match = re.search(r'option is: "([A-D])"', user_msg, re.IGNORECASE)

                if qid_match:
                    qid = int(qid_match.group(1))
                    label = label_match.group(1) if label_match else "A"

                    print(f"   🛡️ Intercepting Check -> QID: {qid}, Label: {label}, Offline: {use_offline}")

                    return explain_mcq_answer_tool(
                        question_id=qid,
                        student_answer_label=label,
                        use_offline=use_offline
                    )
            except Exception as e:
                print(f"   ⚠️ Interception failed: {e}")
                # Fall through to normal agent if parsing fails

        # 4. 🗣️ NORMAL CHAT: Run the agent
        print(f"   💬 Chatting via {target_app_name.upper()} Agent (Session: {session_id})...")

        content = types.Content(role="user", parts=[types.Part(text=user_msg)])
        final_text = ""

        try:
            async for event in target_runner.run_async(
                    user_id=user_id,
                    session_id=session_id,
                    new_message=content
            ):
                if event.is_final_response() and event.content:
                    final_text = event.content.parts[0].text or ""
                elif getattr(event, "error_message", None):
                    print(f"   ❌ Event Error: {event.error_message}")

        except Exception as e:
            print(f"   ❌ Runner Error: {e}")
            return f"Error from {target_app_name} agent: {str(e)}"

        return final_text or "[No response]"


# Singleton instance
chat_manager = ChatManager()