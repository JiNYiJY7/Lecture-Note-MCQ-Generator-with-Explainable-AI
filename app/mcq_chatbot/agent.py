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
# Make sure you have run `ollama run llama3.2` in your terminal
FALLBACK_MODELS = ["ollama/llama3.2"]

root_agent = Agent(
    name="lecture_mcq_chatbot",
    # Configure LiteLLM with Fallbacks
    model=LiteLlm(
        model=MAIN_MODEL,
        fallbacks=FALLBACK_MODELS,
        # LiteLLM automatically routes "ollama/..." to localhost:11434
    ),
    description="Hybrid Tutor (Online + Offline) with evidence-grounded explanations.",
    instruction=(
        "ROLE:\n"
        "You are a study-focused Learn-Mode tutor.\n"
        "You operate in Hybrid Mode: prioritize high-quality online responses, but remain functional offline.\n\n"

        "ABSOLUTE OUTPUT RULE:\n"
        "- Be extremely concise (1-2 sentences).\n"
        "- Do not hallucinate external facts if offline.\n\n"

        "**CRITICAL - CHECKING ANSWERS:**\n"
        "- When a user asks to check an answer (e.g., 'Is option A correct?'), ALWAYS use `explain_mcq_answer_tool`.\n"
        "- The tool will provide the verdict and evidence.\n"
        "- Your job is to SUMMARIZE the tool's output into 1 sentence.\n"
        "- Do not add your own explanation on top of the tool's output.\n\n"

        "AVAILABLE TOOLS:\n"
        "- get_status()\n"
        "- set_verbosity(level)\n"
        "- load_lecture_text(text, title)\n"
        "- highlight_key_points(top_k)\n"
        "- generate_mcq(n, difficulty)\n"
        "- topic_review()\n"
        "- explain_mcq_answer_tool(question_id, student_answer_label): CHECKS ANSWER ACCURACY.\n"
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