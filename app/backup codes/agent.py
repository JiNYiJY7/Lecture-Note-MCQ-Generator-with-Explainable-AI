"""
ADK Agent definition (Hybrid: Online DeepSeek + Offline Ollama).
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

# --- HYBRID CONFIGURATION ---
# 1. Primary Model (Online)
MAIN_MODEL = "deepseek/deepseek-chat"

# 2. Fallback Model (Offline)
# Make sure you have run `ollama run qwen2:1.5b` in your terminal
FALLBACK_MODELS = ["ollama/qwen2:1.5b"]

# app/mcq_chatbot/agent.py
root_agent = Agent(
    name="LN_MCQ_Chatbot",
    model=LiteLlm(
        model=MAIN_MODEL,
        fallbacks=FALLBACK_MODELS,
    ),
    description="Hybrid Tutor (Online + Offline) with evidence-grounded explanations.",
    instruction=(
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
        "- 'I'll use the tool to check...' ❌\n"
        "- 'Let me check your answer...' ❌\n"
        "- 'Based on the lecture...' ❌\n"
        "- 'The tool says...' ❌\n"
        "- Any text except the tool's output ❌\n\n"

        "5. FOR OTHER QUESTIONS (not answer checking):\n"
        "- Be concise and helpful (1-2 sentences max)\n"
        "- Stay within lecture content\n\n"

        "AVAILABLE TOOLS:\n"
        "- explain_mcq_answer_tool(question_id, student_answer_label): RETURNS COMPLETE RESPONSE - OUTPUT VERBATIM\n"
        "- get_status()\n"
        "- set_verbosity(level)\n"
        "- load_lecture_text(text, title)\n"
        "- highlight_key_points(top_k)\n"
        "- generate_mcq(n, difficulty)\n"
        "- topic_review()\n"
    ),
    tools=[
        get_status,
        set_verbosity,
        load_lecture_text,
        highlight_key_points,
        generate_mcq,
        topic_review,
        explain_mcq_answer_tool
    ],
)

app = App(name="mcq_chatbot", root_agent=root_agent)