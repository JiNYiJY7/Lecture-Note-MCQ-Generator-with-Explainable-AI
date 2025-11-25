import { useState } from 'react';
import { api } from './api';

export default function QuizView({ questions }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [explanation, setExplanation] = useState(null);
  const [loadingXAI, setLoadingXAI] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);

  const question = questions[currentIndex];

  const handleOptionClick = async (label) => {
    setSelectedOption(label);
    setLoadingXAI(true);
    try {
      // Call Module 4: XAI
      const result = await api.getExplanation(question.id, label);
      setExplanation(result);
    } catch (err) {
      alert("XAI Error: " + err.message);
    } finally {
      setLoadingXAI(false);
    }
  };

  const nextQuestion = () => {
    setExplanation(null);
    setSelectedOption(null);
    setCurrentIndex((prev) => prev + 1);
  };

  if (!question) return <h2>Quiz Completed!</h2>;

  return (
    <div className="card" style={{ textAlign: 'left', maxWidth: '600px', margin: '0 auto' }}>
      <h3>Question {currentIndex + 1}</h3>
      <p style={{ fontSize: '1.2em' }}>{question.stem}</p>

      <div className="options-grid">
        {question.options.map((opt) => (
          <button
            key={opt.label}
            onClick={() => handleOptionClick(opt.label)}
            disabled={!!explanation} // Disable after answering
            style={{
              display: 'block',
              width: '100%',
              margin: '10px 0',
              backgroundColor: selectedOption === opt.label ? '#646cff' : '',
              color: selectedOption === opt.label ? 'white' : ''
            }}
          >
            <strong>{opt.label}:</strong> {opt.text}
          </button>
        ))}
      </div>

      {loadingXAI && <p><em>Asking AI for explanation...</em></p>}

      {explanation && (
        <div style={{
          marginTop: '20px',
          padding: '15px',
          background: explanation.is_correct ? '#e6fffa' : '#fff5f5',
          border: `1px solid ${explanation.is_correct ? '#38a169' : '#e53e3e'}`,
          borderRadius: '8px',
          color: '#333'
        }}>
          <h4 style={{ margin: '0 0 10px 0' }}>
            {explanation.is_correct ? "✅ Correct!" : "❌ Incorrect"}
          </h4>
          <p><strong>AI Tutor:</strong> {explanation.reasoning}</p>
          {explanation.key_concepts && (
            <small><strong>Evidence:</strong> {explanation.key_concepts[0]}</small>
          )}
          <div style={{ marginTop: '15px', textAlign: 'right' }}>
            <button onClick={nextQuestion}>Next Question →</button>
          </div>
        </div>
      )}
    </div>
  );
}