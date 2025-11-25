import { useState } from 'react'
import './App.css'
import SetupView from './SetupView'
import QuizView from './QuizView'

function App() {
  const [questions, setQuestions] = useState([]);

  return (
    <div className="App">
      <h1>AI Lecture Tutor</h1>
      
      {questions.length === 0 ? (
        <SetupView onQuizReady={setQuestions} />
      ) : (
        <QuizView questions={questions} />
      )}
    </div>
  )
}

export default App