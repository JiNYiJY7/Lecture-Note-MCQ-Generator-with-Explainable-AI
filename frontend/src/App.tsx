import { useState } from "react";
import { Homepage } from "./components/Homepage";
import { MCQPage } from "./components/MCQPage";
import { ResultsPage } from "./components/ResultsPage";
import { Toaster } from "sonner"; // Import Toaster directly if using sonner

type Page = "home" | "quiz" | "results";

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const [questions, setQuestions] = useState<any[]>([]); // Store generated questions
  const [quizScore, setQuizScore] = useState(0);

  // Called when Homepage finishes generating
  const handleStartQuiz = (generatedQuestions: any[]) => {
    setQuestions(generatedQuestions);
    setCurrentPage("quiz");
  };

  const handleQuizComplete = (score: number) => {
    setQuizScore(score);
    setCurrentPage("results");
  };

  const handleReturnHome = () => {
    setCurrentPage("home");
    setQuestions([]);
    setQuizScore(0);
  };

  return (
    <>
      {currentPage === "home" && (
        <Homepage onStartQuiz={handleStartQuiz} />
      )}

      {currentPage === "quiz" && (
        <MCQPage
            questions={questions}
            onComplete={handleQuizComplete}
        />
      )}

      {currentPage === "results" && (
        <ResultsPage
          score={quizScore}
          totalQuestions={questions.length}
          onReturnHome={handleReturnHome}
        />
      )}
      <Toaster />
    </>
  );
}