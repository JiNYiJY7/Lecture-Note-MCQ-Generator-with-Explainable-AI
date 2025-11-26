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

  // Module 2: Generate
  generateMCQs: async (lectureId) => {
    const response = await axios.post(`${API_BASE}/mcq/generate`, {
      lecture_id: lectureId,
      num_questions: 3,
      use_llm: true
    });
    return response.data; // Returns { questions: [...], question_ids: [...] }
  },

  // Module 4: XAI Explain
  getExplanation: async (questionId, studentAnswer) => {
    const response = await axios.post(`${API_BASE}/xai/explain`, {
      question_id: questionId,
      student_answer_label: studentAnswer
    });
    return response.data; // Returns { is_correct, reasoning, ... }
  }
};