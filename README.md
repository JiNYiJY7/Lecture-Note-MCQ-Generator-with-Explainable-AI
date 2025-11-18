# Lecture Note MCQ Generator with Explainable AI

Workshop 2 backend scaffold that keeps each feature modular and easy to
describe in reports.

## Quick start

```bash
python -m venv .venv
.venv\Scripts\activate  # On PowerShell
pip install -r requirements.txt

set FLASK_APP=app.main   # Windows
flask run
```

### Frontend

```bash
cd frontend
npm install
npm run dev  # Launches http://localhost:5173
```

## Architecture overview

- **Document Processing** (`app/modules/document_processing`): converts
  PDF/DOCX/TXT files into normalized text. Currently returns placeholders with
  TODOs for format detection, extraction, and cleaning.
- **MCQ Generation + XAI** (`app/modules/mcq_generation`): creates questions,
  distractors, and attaches explanation metadata (TF-IDF + rule-based + LLM
  stubs).
- **MCQ Management** (`app/modules/mcq_management`): SQLAlchemy models,
  repository layer, and REST routes for storing/serving MCQs.
- **Frontend Dashboard** (`frontend/`): Vite + React SPA that mirrors the
  three backend modules so the workflow is easy to demo and explain. Buttons
  currently show placeholder state and include TODO notes for wiring up the
  Flask APIs.

Each module includes TODO comments that map directly to the methodology
sections we will elaborate later.

