# THIS CODING IS NOT BEING USED ANYMORE

from google.adk.models import Model
from litellm import completion
import os

class HybridModel:
    def __init__(self, *args, **kwargs):
        pass

    def run(self, *args, **kwargs):
        raise NotImplementedError("HybridModel is disabled. Use online_agent or offline_agent.")

    async def run_async(self, *args, **kwargs):
        raise NotImplementedError("HybridModel is disabled. Use online_agent or offline_agent.")

class MockResponse:
    """Helper to mimic the object ADK expects back"""
    def __init__(self, text):
        self.text = text
    # You might need to adjust this depending on exactly what ADK's 'Model' class expects as a return type
    # For many simple ADK agents, returning a string or an object with .text works.