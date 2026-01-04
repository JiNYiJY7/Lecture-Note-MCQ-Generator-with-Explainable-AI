"""
ADK Agent definition (Manual Switching Mode).
Exports separate Agents so the system never accidentally calls DeepSeek in Offline mode.
"""
from __future__ import annotations

from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models.lite_llm import LiteLlm

# --- REAL TOOL IMPORT ---
from app.modules.xai.agent_tools import explain_mcq_answer_tool

# --- DEMO TOOLS IMPORT ---
from .tools import (
    get_status,
    set_verbosity,
    load_lecture_text,
    highlight_key_points,
    generate_mcq,
    topic_review,
)

# --- CONFIGURATION ---
ONLINE_MODEL = "deepseek/deepseek-chat"
OFFLINE_MODEL = "ollama/llama3.2:1b"

# --- Online INSTRUCTION ---
online_instruction = (
    "CRITICAL RULES - READ CAREFULLY:\n\n"

    "1. WHEN USER ASKS TO CHECK AN ANSWER:\n"
    "- IMMEDIATELY call `explain_mcq_answer_tool(question_id, student_answer_label)` with ONLY those two parameters\n"
    "- Output the tool's response EXACTLY as is - NO additional text, NO commentary, NO explanations\n"
    "- DO NOT say you're using the tool\n"
    "- DO NOT comment on the user's message\n"
    "- DO NOT ask for more information\n"
    "- The tool will handle everything automatically\n\n"

    "2. REQUIRED OUTPUT FORMAT (from tool):\n"
    "- Correct: 'Correct - [1 sentence specific explanation]'\n"
    "- Incorrect: 'Incorrect - [1 sentence]. You likely chose this because [1 sentence]'\n\n"

    "3. EXAMPLES OF WHAT TO OUTPUT (only these exact formats):\n"
    "Correct examples:\n"
    "- 'Correct - Your answer matches the lecture explanation about neural network training.'\n"
    "- 'Correct - The lecture states this definition clearly, which you identified correctly.'\n\n"
    "Incorrect examples:\n"
    "- 'Incorrect - The relationship is actually reversed in the lecture. You likely chose this because the hierarchy can be confusing.'\n"
    "- 'Incorrect - This option describes a benefit, not the core concept. You likely chose this because you focused on outcomes rather than definitions.'\n\n"

    "4. WHAT NOT TO DO (NEVER):\n"
    "- 'I'll use the tool to check...' \n"
    "- 'Let me check your answer...' \n"
    "- 'Based on the lecture...' \n"
    "- 'The tool says...' \n"
    "- Any text except the tool's output \n"
    "- Bold usage (** **) \n\n"

    "5. FOR OTHER QUESTIONS (not answer checking):\n"
    "- Be concise and helpful (50 words max)\n"
    "- Stay within lecture content\n\n"
    "- If the lecture context is missing or doesn't fully explain a concept, use your own general knowledge to provide a clear, helpful explanation.\n\n"

    "AVAILABLE TOOLS:\n"
    "- explain_mcq_answer_tool(question_id, student_answer_label): RETURNS COMPLETE RESPONSE - OUTPUT VERBATIM\n"
    "- get_status()\n"
    "- set_verbosity(level)\n"
    "- load_lecture_text(text, title)\n"
    "- highlight_key_points(top_k)\n"
    "- generate_mcq(n, difficulty)\n"
    "- topic_review()\n"
)

offline_instruction = (
    "You are a helpful, concise AI Tutor.\n"
    "Answer the user's questions clearly using the provided lecture context.\n"
    "Keep your answers short (under 50 words) and direct.\n"
    "Do not mention tools or technical details.\n"
    "Do not state your name. \n\n"
)

shared_tools = [
    get_status,
    set_verbosity,
    load_lecture_text,
    highlight_key_points,
    generate_mcq,
    topic_review,
    explain_mcq_answer_tool
]

# --- 1. ONLINE AGENT (Strictly DeepSeek) ---
online_agent = Agent(
    name="LN_MCQ_Chatbot_Online",
    model=LiteLlm(model=ONLINE_MODEL, timeout=120),
    description="Online Tutor (DeepSeek)",
    instruction=online_instruction,
    tools=shared_tools
)

# --- 2. OFFLINE AGENT (Strictly Llama 3.2) ---
# ✅ FIXED: Force api_base to localhost so it never tries to go online
offline_agent = Agent(
    name="AI_Tutor",
    model=LiteLlm(
        model=OFFLINE_MODEL,
        timeout=120,
        api_base="http://localhost:11434"
    ),
    description="Offline Tutor (Llama 3.2)",
    instruction=offline_instruction,
    tools=[]
)
# --- EXPORTS ---

# 1. Apps (Used by router.py for switching)
online_app = App(name="mcq_chatbot_online", root_agent=online_agent)
offline_app = App(name="mcq_chatbot_offline", root_agent=offline_agent)

# 2. Aliases
root_agent = online_agent
app = online_app