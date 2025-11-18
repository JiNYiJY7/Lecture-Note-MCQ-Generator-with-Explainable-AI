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

Update `src/App.jsx` when new API routes are available—fetch handlers are
already stubbed out with TODO comments to keep the integration steps clear for
the methodology writeup.
