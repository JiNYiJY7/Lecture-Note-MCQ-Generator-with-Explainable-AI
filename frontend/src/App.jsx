// frontend/src/App.jsx
import { useState } from "react";
import "./App.css";

const API_BASE = "http://127.0.0.1:8000/api";

function App() {
  const [activeTab, setActiveTab] = useState(1);
  const [darkMode, setDarkMode] = useState(false);

  // Step 1: lecture upload / processing
  const [lectureTitle, setLectureTitle] = useState("");
  const [lectureText, setLectureText] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [sectionsPreview, setSectionsPreview] = useState([]);
  const [uploadWarning, setUploadWarning] = useState("");

  // Step 2: MCQ generation + attempt
  const [numQuestions, setNumQuestions] = useState(3);
  const [useLLM, setUseLLM] = useState(true);
  const [mcqs, setMcqs] = useState([]);
  const [answers, setAnswers] = useState({}); // {questionIndex: "A" | "B" | ...}
  const [loadingMcq, setLoadingMcq] = useState(false);

  // Step 3: XAI explanations (submit-all mode)
  const [submitted, setSubmitted] = useState(false); // lock answers + show colours after submit
  const [xaiMap, setXaiMap] = useState({}); // {questionIndex: XAIExplanationResponse}
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(null);
  const [loadingExplainAll, setLoadingExplainAll] = useState(false);

  // Global error banner
  const [error, setError] = useState("");

  // --------------------------------------------------------
  // Helpers
  // --------------------------------------------------------

  function resetErrors() {
    setError("");
  }

  // Very simple front-end "section" splitter for preview only
  function splitIntoSections(text) {
    if (!text.trim()) return [];

    const rawParts = text
      .split(/\n\s*\n|(?=^\d+\.\s)/gm)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    return rawParts.map((content, idx) => ({
      index: idx + 1,
      content,
    }));
  }

  // --------------------------------------------------------
  // Step 1: upload / process
  // --------------------------------------------------------
  const handleFileUpload = (event) => {
    resetErrors();
    setUploadWarning("");

    const file = event.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);

    const ext = file.name.toLowerCase().split(".").pop();

    if (ext === "txt") {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result?.toString() || "";
        setLectureText(text);
        if (!lectureTitle) {
          setLectureTitle(file.name.replace(/\.[^/.]+$/, ""));
        }
      };
      reader.readAsText(file);
    } else if (["pdf", "doc", "docx"].includes(ext)) {
      // Prototype: only show a friendly warning, no parsing yet
      setUploadWarning(
        "PDF / Word text extraction is not implemented in this prototype yet. " +
          "Please open the file and paste the important lecture text into the textbox below."
      );
      if (!lectureTitle) {
        setLectureTitle(file.name.replace(/\.[^/.]+$/, ""));
      }
    } else {
      setError("Unsupported file type. Please upload .txt / .pdf / .doc / .docx.");
    }
  };

  const handleProcessLecture = () => {
    resetErrors();
    if (!lectureText.trim()) {
      setError("Please paste some lecture text or upload a .txt file first.");
      return;
    }
    const sections = splitIntoSections(lectureText);
    setSectionsPreview(sections);
    setActiveTab(2);
  };

  // --------------------------------------------------------
  // Step 2: MCQ generation + attempt
  // --------------------------------------------------------
  const handleGenerateMcqs = async () => {
    resetErrors();

    if (!lectureText.trim()) {
      setError("Please process a lecture in Step 1 before generating MCQs.");
      setActiveTab(1);
      return;
    }

    setLoadingMcq(true);
    setMcqs([]);
    setAnswers({});
    setXaiMap({});
    setSubmitted(false);
    setSelectedQuestionIndex(null);

    try {
      const payload = {
        lecture_text: lectureText,
        lecture_id: null,
        section_id: null,
        num_questions: Number(numQuestions) || 3,
        use_llm: useLLM,
      };

      const resp = await fetch(`${API_BASE}/mcq/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new Error(
          data?.detail || `Failed to generate MCQs (status ${resp.status})`
        );
      }

      const data = await resp.json();
      setMcqs(data.questions || []);
      setActiveTab(3);
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to generate MCQs.");
    } finally {
      setLoadingMcq(false);
    }
  };

  const handleAnswerChange = (qIdx, label) => {
    if (submitted) return; // lock answers after submission
    setAnswers((prev) => ({ ...prev, [qIdx]: label }));
  };

  // --------------------------------------------------------
  // Step 3: submit all + XAI explanations
  // --------------------------------------------------------
  const handleSubmitAll = async () => {
    resetErrors();

    if (!mcqs.length) {
      setError("No MCQs available. Please generate questions first.");
      return;
    }

    // Ensure every question has an answer
    for (let i = 0; i < mcqs.length; i++) {
      if (!answers[i]) {
        setError(`Please answer Question ${i + 1} before submitting.`);
        return;
      }
    }

    setLoadingExplainAll(true);
    setSubmitted(false);
    setXaiMap({});
    setSelectedQuestionIndex(null);

    try {
      const promises = mcqs.map(async (q, qIdx) => {
        const studentLabel = answers[qIdx];

        const payload = {
          // Stateless mode: question_id is null
          question_id: null,
          student_answer_label: studentLabel,
          question_stem: q.stem,
          options: q.options,
          correct_label: q.correct_label,
          lecture_text: lectureText,
        };

        const resp = await fetch(`${API_BASE}/xai/explain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => null);
          throw new Error(
            data?.detail ||
              `Failed to get explanation for Question ${qIdx + 1} (status ${resp.status})`
          );
        }

        const data = await resp.json();
        return { index: qIdx, explanation: data };
      });

      const results = await Promise.all(promises);
      const map = {};
      results.forEach(({ index, explanation }) => {
        map[index] = explanation;
      });
      setXaiMap(map);
      setSubmitted(true);

      // Focus first question (prefer the first incorrect one)
      const firstIncorrect = results.find(
        ({ index }) => answers[index] !== mcqs[index].correct_label
      );
      setSelectedQuestionIndex(
        (firstIncorrect && firstIncorrect.index) ?? 0
      );
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to get explanations.");
    } finally {
      setLoadingExplainAll(false);
    }
  };

  // --------------------------------------------------------
  // Render helpers
  // --------------------------------------------------------

  const renderSectionsPreview = () => {
    if (!sectionsPreview.length) {
      return <p className="placeholder">No auto-splitting preview yet.</p>;
    }

    return (
      <ul className="section-list">
        {sectionsPreview.map((s) => (
          <li key={s.index}>
            <div className="section-index">Section {s.index}</div>
            <div className="section-content">
              {s.content.length > 160
                ? s.content.slice(0, 160) + "..."
                : s.content}
            </div>
          </li>
        ))}
      </ul>
    );
  };

  const renderMcqList = () => {
    if (!mcqs.length) {
      return (
        <p className="placeholder">
          No MCQs generated yet. Go to{" "}
          <button
            className="link-button-inline"
            onClick={() => setActiveTab(2)}
          >
            Step 2
          </button>{" "}
          to generate.
        </p>
      );
    }

    return (
      <div className="mcq-list">
        {mcqs.map((q, qIdx) => {
          const studentLabel = answers[qIdx];
          const correctLabel = q.correct_label;
          const hasAnswer = !!studentLabel;
          const isCorrect =
            submitted && hasAnswer && studentLabel === correctLabel;
          const xai = xaiMap[qIdx];

          return (
            <div
              key={qIdx}
              className={
                "mcq-card" +
                (selectedQuestionIndex === qIdx ? " mcq-card-active" : "") +
                (submitted
                  ? isCorrect
                    ? " mcq-card-correct"
                    : " mcq-card-wrong"
                  : "")
              }
              onClick={() => setSelectedQuestionIndex(qIdx)}
            >
              <div className="mcq-header">
                <span className="mcq-number">Question {qIdx + 1}</span>
                <span className="mcq-difficulty">
                  {submitted && hasAnswer
                    ? isCorrect
                      ? "Correct"
                      : "Incorrect"
                    : "Generated"}
                </span>
              </div>
              <p className="mcq-stem">{q.stem}</p>
              <div className="mcq-options">
                {q.options.map((opt) => {
                  const checked = studentLabel === opt.label;
                  let optionClass = "mcq-option";

                  if (submitted) {
                    // After submit: wrong answer red, correct answer green
                    if (opt.label === correctLabel && opt.label === studentLabel) {
                      optionClass += " mcq-option-correct"; // chosen and correct
                    } else if (
                      opt.label === studentLabel &&
                      opt.label !== correctLabel
                    ) {
                      optionClass += " mcq-option-wrong"; // chosen but wrong
                    } else if (opt.label === correctLabel) {
                      optionClass += " mcq-option-correct-ghost"; // correct but not chosen
                    }
                  } else if (checked) {
                    // Before submit: simple selected state
                    optionClass += " mcq-option-selected";
                  }

                  return (
                    <label key={opt.label} className={optionClass}>
                      <input
                        type="radio"
                        name={`q-${qIdx}`}
                        value={opt.label}
                        checked={checked}
                        disabled={submitted}
                        onChange={() => handleAnswerChange(qIdx, opt.label)}
                      />
                      <span className="mcq-option-label">{opt.label}.</span>
                      <span>{opt.text}</span>
                    </label>
                  );
                })}
              </div>

              {submitted && xai && (
                <div className="mcq-xai-snippet">
                  <strong>
                    {isCorrect ? "Why this is correct:" : "Why this is incorrect:"}
                  </strong>
                  <p>
                    {xai.reasoning.slice(0, 220)}
                    {xai.reasoning.length > 220 ? "..." : ""}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderXaiPanel = () => {
    if (!submitted) {
      return (
        <p className="placeholder">
          Answer all questions and click <strong>“Submit”</strong> to see
          detailed explanations here.
        </p>
      );
    }

    if (
      selectedQuestionIndex === null ||
      xaiMap[selectedQuestionIndex] === undefined
    ) {
      return (
        <p className="placeholder">
          Select a question card on the left to view its explanation.
        </p>
      );
    }

    const xai = xaiMap[selectedQuestionIndex];
    const isCorrect = xai.is_correct;

    // Clean short / meaningless items such as "The"
    const cleanList = (list) =>
      (list || []).filter((item) => {
        if (!item) return false;
        const t = item.trim();
        if (!t) return false;
        if (t.length <= 3 && ["the", "and", "to"].includes(t.toLowerCase())) {
          return false;
        }
        return true;
      });

    const keyConcepts = cleanList(xai.key_concepts);
    const reviewTopics = cleanList(xai.review_topics);

    return (
      <div className="xai-card">
        <div className="xai-status">
          <span
            className={
              "badge" + (isCorrect ? " badge-correct" : " badge-wrong")
            }
          >
            {isCorrect ? "Correct" : "Incorrect"}
          </span>
          <span className="xai-subtitle">
            Your answer: {xai.student_label} · Correct answer:{" "}
            {xai.correct_label}
          </span>
        </div>
        <div className="xai-section">
          <h4>Reasoning</h4>
          <p>{xai.reasoning}</p>
        </div>
        <div className="xai-section">
          <h4>Key concepts</h4>
          <ul>
            {keyConcepts.length
              ? keyConcepts.map((c, idx) => <li key={idx}>{c}</li>)
              : "—"}
          </ul>
        </div>
        <div className="xai-section">
          <h4>Suggested topics to review</h4>
          <ul>
            {reviewTopics.length
              ? reviewTopics.map((t, idx) => <li key={idx}>{t}</li>)
              : "—"}
          </ul>
        </div>
      </div>
    );
  };

  // Helper: are all questions answered?
  const allAnswered =
    mcqs.length > 0 && mcqs.every((_, idx) => answers[idx] !== undefined);

  // --------------------------------------------------------
  // JSX
  // --------------------------------------------------------

  return (
    <div className={`app-root ${darkMode ? "dark" : ""}`}>
      <header className="app-header">
        <div>
          <h1>Lecture MCQ Generator with XAI</h1>
          <p className="app-subtitle">
            Mini LMS-style UI · Backend: FastAPI · Modules: Document Processing ·
            MCQ Generation · MCQ Management · XAI
          </p>
        </div>
        <button
          className="btn-toggle-mode"
          onClick={() => setDarkMode((v) => !v)}
        >
          {darkMode ? "☀️ Light" : "🌙 Dark"}
        </button>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${activeTab === 1 ? "active" : ""}`}
          onClick={() => setActiveTab(1)}
        >
          1. Upload Lecture
        </button>
        <button
          className={`tab ${activeTab === 2 ? "active" : ""}`}
          onClick={() => setActiveTab(2)}
        >
          2. Generate MCQs
        </button>
        <button
          className={`tab ${activeTab === 3 ? "active" : ""}`}
          onClick={() => setActiveTab(3)}
        >
          3. Attempt & Explain
        </button>
      </nav>

      {error && <div className="alert alert-error">Error: {error}</div>}

      <main className="app-main">
        {/* STEP 1 --------------------------------------------------- */}
        {activeTab === 1 && (
          <section className="card">
            <h2>1. Upload & Process Lecture</h2>
            <p className="section-intro">
              Upload a <strong>.txt / .pdf / .doc / .docx</strong> file or paste
              lecture text. In this prototype, TXT files are parsed on the
              browser; PDF / Word parsing will be handled on the backend in a
              later version.
            </p>

            <div className="form-grid">
              <div className="form-column">
                <label className="field-label">Lecture file (optional):</label>
                <input
                  type="file"
                  accept=".txt,.pdf,.doc,.docx"
                  onChange={handleFileUpload}
                />
                {uploadedFileName && (
                  <p className="file-hint">Selected: {uploadedFileName}</p>
                )}
                {uploadWarning && (
                  <p className="file-warning">{uploadWarning}</p>
                )}

                <label className="field-label">Lecture title:</label>
                <input
                  type="text"
                  value={lectureTitle}
                  onChange={(e) => setLectureTitle(e.target.value)}
                  placeholder="e.g. Software Engineering Basics"
                />

                <label className="field-label">Lecture text:</label>
                <textarea
                  className="textarea"
                  rows={12}
                  value={lectureText}
                  onChange={(e) => setLectureText(e.target.value)}
                  placeholder="Paste cleaned text from PDF / Word here..."
                />

                <button
                  className="btn-primary"
                  onClick={handleProcessLecture}
                >
                  Auto-split &amp; Continue
                </button>
              </div>

              <div className="form-column">
                <h3 className="preview-title">Auto-splitting preview</h3>
                <p className="preview-subtitle">
                  This is a simple NLP-style preview showing how your lecture
                  might be split into sections (for MCQ generation later).
                </p>
                {renderSectionsPreview()}
              </div>
            </div>
          </section>
        )}

        {/* STEP 2 --------------------------------------------------- */}
        {activeTab === 2 && (
          <section className="card">
            <h2>2. Generate MCQs</h2>
            <p className="section-intro">
              Based on the lecture text from Step 1. You can adjust how many
              questions to generate and whether to use the DeepSeek LLM.
            </p>

            <div className="form-row">
              <div className="form-group-inline">
                <label>Number of questions:</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={numQuestions}
                  onChange={(e) => setNumQuestions(e.target.value)}
                />
              </div>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={useLLM}
                  onChange={(e) => setUseLLM(e.target.checked)}
                />
                <span>Use LLM (DeepSeek)</span>
              </label>
              <button
                className="btn-primary"
                onClick={handleGenerateMcqs}
                disabled={loadingMcq}
              >
                {loadingMcq ? "Generating..." : "Generate MCQs"}
              </button>
            </div>

            <div className="hint-box">
              <strong>Note:</strong> For now the system sends the raw lecture
              text directly to the backend, without requiring a database
              <code> lecture_id</code>. This makes it easy to test with any
              pasted notes.
            </div>
          </section>
        )}

        {/* STEP 3 --------------------------------------------------- */}
        {activeTab === 3 && (
          <section className="card card-split">
            <div className="card-left">
              <h2>3. Attempt MCQs &amp; Get Explanations</h2>
              <p className="section-intro">
                Answer each question, then click <strong>“Submit”</strong> at
                the bottom to check which answers are correct and see detailed
                explanations.
              </p>

              {renderMcqList()}

              <div className="submit-row">
                <button
                  className="btn-primary"
                  onClick={handleSubmitAll}
                  disabled={loadingExplainAll || !mcqs.length}
                >
                  {loadingExplainAll ? "Checking..." : "Submit"}
                </button>
                {!allAnswered && mcqs.length > 0 && !loadingExplainAll && (
                  <span className="submit-hint">
                    Please answer all questions before submitting.
                  </span>
                )}
              </div>
            </div>
            <div className="card-right">
              <h3>Explainable AI Panel</h3>
              {renderXaiPanel()}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
