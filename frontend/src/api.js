import axios from "axios";

const API_BASE = "http://127.0.0.1:8000/api";

export const api = {
  // Module 1: Upload
  uploadDocument: async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await axios.post(`${API_BASE}/documents/upload`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data; // Returns { id, title, ... }
  },

  // Home: Get list of all quizzes
  getLectures: async () => {
    const response = await axios.get(`${API_BASE}/management/lectures`);
    return response.data;
  },

  // Home: Get questions for a specific quiz
  getQuizQuestions: async (lectureId) => {
    const response = await axios.get(
      `${API_BASE}/management/lectures/${lectureId}/questions`
    );
    return response.data;
  },

  // Home: Soft delete a quiz
  deleteLecture: async (lectureId) => {
    const response = await axios.delete(
      `${API_BASE}/management/lectures/${lectureId}`
    );
    return response.data;
  },

  // Module 2: Generate
  // ✅ difficulty is OPTIONAL:
  // - undefined / null / "mixed" / "any" => do NOT send difficulty (keeps current mixed behaviour)
  // - "easy" | "medium" | "hard" => sends difficulty to backend
  generateMCQs: async (lectureId, numQuestions = 3, difficulty) => {
    const payload = {
      lecture_id: lectureId,
      num_questions: numQuestions,
      use_llm: true,
    };

    const d = (difficulty || "").toString().trim().toLowerCase();
    if (d === "easy" || d === "medium" || d === "hard") {
      payload.difficulty = d;
    }
    // else: do not include difficulty at all (mixed)

    const response = await axios.post(`${API_BASE}/mcq/generate`, payload);
    return response.data;
  },

  // Module 4: XAI Explain (structured)
  // Expected: { is_correct, correct_label, reasoning, ... }
  getExplanation: async (questionId, studentAnswer) => {
    const response = await axios.post(`${API_BASE}/xai/explain`, {
      question_id: questionId,
      student_answer_label: studentAnswer,
    });
    return response.data;
  },

  // ✅ Fast/structured check for correctness + correct label
  // Uses the same endpoint to keep it simple and guaranteed.
  // Returns: { is_correct, correct_label }
  checkAnswer: async (questionId, studentAnswer) => {
    const data = await api.getExplanation(questionId, studentAnswer);
    return {
      is_correct: !!data?.is_correct,
      correct_label: data?.correct_label ?? null,
    };
  },

  // Chatbot function (free-form explanation / tutoring)
  sendChatMessage: async (sessionId, message) => {
    const response = await axios.post(`${API_BASE}/xai/chat`, {
      session_id: sessionId.toString(),
      message: message,
      user_id: "student_1",
    });
    return response.data; // Returns { response: "..." }
  },
};
