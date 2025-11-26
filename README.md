# Lecture Note MCQ Generator with Explainable AI

Workshop 2 backend scaffold that keeps each feature modular and easy to
describe in reports.

## Quick start

This project has two main parts:

1. **Backend API** (Python, FastAPI-style app served with Uvicorn)
2. **Frontend Dashboard** (React + Vite)

---

## .env Setup

    # DeepSeek API Key (required for MCQ Generation + XAI)
    DEEPSEEK_API_KEY=your_api_key_here

Restart the backend server after updating the `.env` file.


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
