"""
mcq_chatbot package.

Exports:
- root_agent: the ADK Agent
- app: optional ADK App container (CLI-friendly)
"""

from .agent import app, root_agent

__all__ = ["app", "root_agent"]
