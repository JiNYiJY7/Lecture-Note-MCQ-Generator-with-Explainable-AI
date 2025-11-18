# Lecture Note MCQ Generator with Explainable AI

Workshop 2 backend scaffold that keeps each feature modular and easy to
describe in reports.

## Quick start

This project has two main parts:

1. **Backend API** (Python, FastAPI-style app served with Uvicorn)
2. **Frontend Dashboard** (React + Vite)

---

### Backend

```bash
# 1. Create and activate virtual environment
python -m venv .venv
.venv\Scripts\activate  # On PowerShell (Windows)

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run backend server (Uvicorn)
python -m uvicorn app.main:app --reload
# By default this starts at: http://127.0.0.1:8000
# Interactive API docs (if enabled): http://127.0.0.1:8000/docs


# Frontend (React + Vite)

This single-page UI mirrors the backend pipeline so Workshop teammates can
demonstrate each module interactively.

## Available panels

1. **Document Processing** – accepts a placeholder file path and shows the
   cleaned-text stub. Later we will call `/api/document/process`.
2. **MCQ Generation + XAI** – displays dummy MCQs while waiting for the
   backend logic. The button will eventually hit `/api/mcq/generate`.
3. **MCQ Management** – lists stored MCQs. Wire it to `/api/mcq/list` once the
   repository/database workflow is ready.

## Run locally

```bash
cd frontend
npm install      # already done once, repeat if dependencies change
npm run dev      # starts Vite on http://localhost:5173
```

To run alongside the Flask backend:

```bash
# terminal 1
set FLASK_APP=app.main
flask run

# terminal 2
cd frontend
npm run dev
```

