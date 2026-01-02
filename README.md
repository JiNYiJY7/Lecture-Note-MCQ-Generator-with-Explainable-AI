# Lecture Note MCQ Generator with Explainable AI

Workshop 2 backend scaffold that keeps each feature modular and easy to
describe in reports.

## Quick start

This project has three main parts:

1. **Backend API** (Python, FastAPI-style app served with Uvicorn)
2. **Frontend Dashboard** (React + Vite)
3. **Hybrid AI Engine** (Supports both DeepSeek Online & Ollama Offline)

---

## .env Setup

### 1. Setup Environment Variables (.env)

Create a `.env` file in the root directory:

    # DeepSeek API Key (Required for Online Mode)
    DEEPSEEK_API_KEY=your_api_key_here

    # Note: If this key is missing or the internet is down, 
    # the system automatically switches to Offline Mode (Ollama).

Restart the backend server after updating the `.env` file.

---

### 2. Offline Mode Setup (Ollama)

To enable the **Offline Fallback** (so the app works without internet), you must install Ollama locally.

1. **Download Ollama**: Get it from [ollama.com](https://ollama.com).
2. **Pull the Model**: Open your terminal and run:
   ```bash
   ollama run llama3.2:1b


## Backend

### 1. Create and activate virtual environment

    python -m venv .venv
    .venv\Scripts\activate   # On PowerShell (Windows)

### 2. Install dependencies

    pip install -r requirements.txt

### 3. Run backend server (Uvicorn)

    python -m uvicorn app.main:app --reload

By default the backend starts at:
http://127.0.0.1:8000

Interactive API docs (if enabled):
http://127.0.0.1:8000/docs


## Frontend

This single-page UI mirrors the backend pipeline so Workshop teammates can
demo each module interactively.

### 1. Move into the frontend folder

    cd frontend

### 2. Install dependencies (first time only)

    npm install

### 3. Run the Vite dev server

    npm run dev

By default the frontend starts at:
http://localhost:5173
