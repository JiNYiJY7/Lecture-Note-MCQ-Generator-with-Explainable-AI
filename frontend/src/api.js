import axios from 'axios';

const API_BASE = 'http://127.0.0.1:8000/api';

export const api = {
  // Module 1: Upload
  uploadDocument: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await axios.post(`${API_BASE}/documents/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data; // Returns { id, title, ... }
  },

  // Home: Get list of all quizzes
  getLectures: async () => {
    const response = await axios.get(`${API_BASE}/management/lectures`);
    return response.data;
  },

  // Home: Get questions for a specific quiz (when clicking a card)
  getQuizQuestions: async (lectureId) => {
    const response = await axios.get(`${API_BASE}/management/lectures/${lectureId}/questions`);
    return response.data;
  },

  // Home: Soft delete a quiz
  deleteLecture: async (lectureId) => {
    const response = await axios.delete(`${API_BASE}/management/lectures/${lectureId}`);
    return response.data;
  },

  // Module 2: Generate
  generateMCQs: async (lectureId, numQuestions = 3) => { // Added parameter with default
    const response = await axios.post(`${API_BASE}/mcq/generate`, {
      lecture_id: lectureId,
      num_questions: numQuestions,
      use_llm: true
    });
    return response.data;
  },

  // Module 4: XAI Explain
  getExplanation: async (questionId, studentAnswer) => {
    const response = await axios.post(`${API_BASE}/xai/explain`, {
      question_id: questionId,
      student_answer_label: studentAnswer
    });
    return response.data; // Returns { is_correct, reasoning, ... }
  },

  // Chatbot function
  sendChatMessage: async (sessionId, message) => {
    const response = await axios.post(`${API_BASE}/xai/chat`, {
      session_id: sessionId.toString(), // Ensure string
      message: message,
      user_id: "student_1"
    });
    return response.data; // Returns { response: "..." }
  }
};