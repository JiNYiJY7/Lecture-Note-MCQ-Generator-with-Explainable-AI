import { useState } from 'react';
import { api } from './api';

export default function SetupView({ onQuizReady }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const handleProcess = async () => {
    if (!file) return alert("Please select a file");
    setLoading(true);
    try {
      // 1. Upload
      setStatus("Uploading PDF...");
      const doc = await api.uploadDocument(file);

      // 2. Generate
      setStatus("AI is reading & generating questions...");
      const mcqData = await api.generateMCQs(doc.id);

      // 3. Start Quiz
      // We merge the IDs into the question objects for easier handling
      const questionsWithIds = mcqData.questions.map((q, i) => ({
        ...q,
        id: mcqData.question_ids[i]
      }));

      onQuizReady(questionsWithIds);
    } catch (err) {
      alert("Error: " + err.message);
      setStatus("Failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>1. Upload Lecture Note</h2>
      <input
        type="file"
        accept=".pdf,.txt"
        onChange={(e) => setFile(e.target.files[0])}
      />
      <div style={{ marginTop: '20px' }}>
        <button onClick={handleProcess} disabled={loading || !file}>
          {loading ? "Processing..." : "Upload & Generate Quiz"}
        </button>
      </div>
      <p>{status}</p>
    </div>
  );
}