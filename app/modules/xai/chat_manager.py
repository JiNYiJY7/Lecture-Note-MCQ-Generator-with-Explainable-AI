import re
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app.mcq_chatbot.agent import online_agent, offline_agent
from app.modules.xai.agent_tools import explain_mcq_answer_tool


class ChatManager:
    def __init__(self):
        self.session_service = InMemorySessionService()

        self.online_runner = Runner(
            agent=online_agent,
            app_name="online",
            session_service=self.session_service
        )
        self.offline_runner = Runner(
            agent=offline_agent,
            app_name="offline",
            session_service=self.session_service
        )

    async def send_message(self, session_id: str, user_msg: str, user_id: str = "default_user",
                           use_offline: bool = False) -> str:

        target_runner = self.offline_runner if use_offline else self.online_runner
        target_app_name = "offline" if use_offline else "online"

        # 1. Ensure Session Exists
        try:
            await self.session_service.create_session(
                app_name=target_app_name,
                user_id=user_id,
                session_id=session_id
            )
        except Exception:
            pass

            # 2. INTERCEPT "CHECK ANSWER"
        # We look for keywords that suggest the user is clicking the Check Answer button
        is_tool_prompt = "explain_mcq_answer_tool" in user_msg
        is_manual_check = "question id is" in user_msg.lower()

        if is_tool_prompt or is_manual_check:
            try:
                # ✅ DEBUG: Print the exact message so we know why it failed before
                print(f"   📨 [DEBUG] Incoming Message: '{user_msg}'")

                # EXTRACT QUESTION ID
                qid_match = re.search(r"question ID is[:\s]*(\d+)", user_msg, re.IGNORECASE)

                # ✅ FIX: BETTER REGEX FOR LABEL
                # Captures "Option B", "Selected: B", "Choice B", "Student B", "Answer B"
                label_match = re.search(r"(?:option|answer|choice|selected|student|value)[\s:\"'-]*([A-D])\b", user_msg,
                                        re.IGNORECASE)

                if qid_match:
                    qid = int(qid_match.group(1))

                    # If regex finds a letter, use it. If not, don't default to A blindly.
                    if label_match:
                        label = label_match.group(1).upper()
                    else:
                        # Fallback: Try to find ANY standalone letter A-D if strict regex failed
                        fallback = re.search(r"\b([A-D])\b", user_msg)
                        label = fallback.group(1).upper() if fallback else "A"
                        if not label_match and not fallback:
                            print(f"   ⚠️ [WARNING] Could not find label in message. Defaulting to A.")

                    print(f"   🛡️ Intercepting Check -> QID: {qid}, Label: {label}")

                    return explain_mcq_answer_tool(
                        question_id=qid,
                        student_answer_label=label,
                        use_offline=use_offline
                    )
            except Exception as e:
                print(f"   ⚠️ Interception Error: {e}")
                pass

        # 3. PREPARE CONTEXT (Context Injection)
        context_block = ""
        try:
            if session_id.isdigit():
                from app.core.database import SessionLocal
                from app.modules.mcq_management import service as mcq_service

                db = SessionLocal()
                try:
                    q = mcq_service.get_question_by_id(db, int(session_id))
                    if q and q.lecture and q.lecture.clean_text:
                        text_content = q.lecture.clean_text[:2000]
                        context_block = f"CONTEXT FROM LECTURE:\n\"\"\"\n{text_content}\n\"\"\"\n\n"
                finally:
                    db.close()
        except Exception:
            pass

        full_prompt = f"{context_block}USER QUESTION:\n{user_msg}"

        # 4. RUN CHAT
        print(f"   💬 Chatting via {target_app_name.upper()} Agent...")
        content = types.Content(role="user", parts=[types.Part(text=full_prompt)])
        final_text = ""

        try:
            async for event in target_runner.run_async(
                    user_id=user_id,
                    session_id=session_id,
                    new_message=content
            ):
                if event.is_final_response() and event.content:
                    final_text = event.content.parts[0].text or ""

        except Exception as e:
            return f"Error from {target_app_name} agent: {str(e)}"

        return final_text or "[No response]"


chat_manager = ChatManager()