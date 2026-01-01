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
  // ✅ FIXED: Added 'difficulty' and 'useOffline' parameters
  generateMCQs: async (lectureId, numQuestions, difficulty, useOffline) => {

    // Construct payload matching backend schema
    const payload = {
      lecture_id: lectureId,
      num_questions: parseInt(numQuestions),
      use_offline: useOffline, // Ensure offline flag is sent
      // difficulty will be added below
    };

    // Ensure valid difficulty string is sent
    const d = (difficulty || "").toString().trim().toLowerCase();
    if (["easy", "medium", "hard"].includes(d)) {
      payload.difficulty = d;
    }
    // Note: If "mixed", we don't send difficulty, so Backend defaults to "medium".

    const response = await axios.post(`${API_BASE}/mcq/generate`, payload);
    return response.data;
  },

  // Module 4: XAI Explain (structured)
  getExplanation: async (questionId, studentAnswer) => {
    const response = await axios.post(`${API_BASE}/xai/explain`, {
      question_id: questionId,
      student_answer_label: studentAnswer,
    });
    return response.data;
  },

  // Check correctness
  checkAnswer: async (questionId, studentAnswer) => {
    try {
      const data = await api.getExplanation(questionId, studentAnswer);
      // Fallback if data is empty, though backend should return valid JSON
      if (!data) return { is_correct: false, correct_label: null };

      return {
        is_correct: !!data.is_correct, // Ensure boolean
        correct_label: data.correct_label || null,
      };
    } catch (e) {
      console.error("Check Answer failed", e);
      return { is_correct: false, correct_label: null };
    }
  },

  // Chatbot function
  sendChatMessage: async (sessionId, message, useOffline = false) => {
    const response = await axios.post(`${API_BASE}/xai/chat`, {
      session_id: String(sessionId),
      message: message,
      user_id: "student_1",
      use_offline: useOffline,
    });
    return response.data.response;
  },
};