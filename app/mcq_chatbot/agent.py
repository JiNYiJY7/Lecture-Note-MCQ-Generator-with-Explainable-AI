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

# --- Online INSTRUCTION (Hardened: no tool/meta leakage to user) ---
online_instruction = (
    "You are an AI Tutor inside an MCQ system.\n\n"
    "CRITICAL RULES:\n"
    "1) Never mention tools, function calls, tool names, parameters, schemas, or any internal limitations.\n"
    "2) Never output meta text such as:\n"
    "   - 'I understand you want me to use ...'\n"
    "   - 'the tool requires ...'\n"
    "   - 'I cannot modify the tool output format'\n"
    "   - 'Would you like me to proceed?'\n\n"
    "WHEN THE USER IS CHECKING AN ANSWER:\n"
    "- If BOTH a Question ID and a selected option label (A-D) are present, call:\n"
    "  explain_mcq_answer_tool(question_id, student_answer_label)\n"
    "- Output ONLY the final result to the user. No additional commentary.\n"
    "- If either Question ID or option label is missing, ask ONE short question:\n"
    "  'Please provide the Question ID and your selected option (A, B, C, or D).'\n\n"
    "FOR OTHER QUESTIONS:\n"
    "- Be concise and helpful (<= 50 words).\n"
    "- Use lecture context when available; if missing, use general knowledge.\n"
)

# --- Offline INSTRUCTION ---
offline_instruction = (
    "You are a helpful, concise AI Tutor.\n"
    "Answer the user's questions clearly using the provided lecture context.\n"
    "Keep your answers short (under 50 words) and direct.\n"
    "Do not mention tools or technical details.\n"
    "Do not state your name.\n\n"
)

shared_tools = [
    get_status,
    set_verbosity,
    load_lecture_text,
    highlight_key_points,
    generate_mcq,
    topic_review,
    explain_mcq_answer_tool,
]

# --- 1. ONLINE AGENT (Strictly DeepSeek) ---
online_agent = Agent(
    name="LN_MCQ_Chatbot_Online",
    model=LiteLlm(model=ONLINE_MODEL, timeout=120),
    description="Online Tutor (DeepSeek)",
    instruction=online_instruction,
    tools=shared_tools,
)

# --- 2. OFFLINE AGENT (Strictly Llama 3.2) ---
# Force api_base to localhost so it never tries to go online.
offline_agent = Agent(
    name="AI_Tutor",
    model=LiteLlm(
        model=OFFLINE_MODEL,
        timeout=120,
        api_base="http://localhost:11434",
    ),
    description="Offline Tutor (Llama 3.2)",
    instruction=offline_instruction,
    tools=[],
)

# --- EXPORTS ---

# 1. Apps (Used by router.py for switching)
online_app = App(name="mcq_chatbot_online", root_agent=online_agent)
offline_app = App(name="mcq_chatbot_offline", root_agent=offline_agent)

# 2. Aliases
root_agent = online_agent
app = online_app
