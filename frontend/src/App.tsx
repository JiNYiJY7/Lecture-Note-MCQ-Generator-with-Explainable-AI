import { useEffect, useState } from "react";
import { Homepage } from "./components/Homepage";
import { MCQPage } from "./components/MCQPage";
import { ResultsPage } from "./components/ResultsPage";
import { Toaster } from "./components/ui/sonner";

export type Mode = "learn" | "quiz";
type Page = "home" | "quiz" | "results";

export interface QuestionResult {
  questionId: number;
  stem: string;
  options: { label: string; text: string }[];
  selectedLabel: string | null;
  isCorrect: boolean;
  correctLabel?: string;
  explanation?: string;
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const [mode, setMode] = useState<Mode>("quiz");
  const [questions, setQuestions] = useState<any[]>([]);
  const [quizScore, setQuizScore] = useState(0);
  const [quizDetails, setQuizDetails] = useState<QuestionResult[]>([]);

  // 1. Restore basic app state on reload (prevents refreshing back to home)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("mcq_app_state");
      if (!saved) return;
      const parsed = JSON.parse(saved);

      if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        setQuestions(parsed.questions);
        setCurrentPage(parsed.currentPage ?? "home");
        setQuizScore(parsed.quizScore ?? 0);
        setMode(parsed.mode ?? "quiz");
        // Note: We don't restore quizDetails here as that's usually transient result data
      }
    } catch (err) {
      console.error("Failed to restore app state", err);
    }
  }, []);

  // 2. Persist basic app state whenever it changes
  useEffect(() => {
    try {
      const data = {
        currentPage,
        questions,
        quizScore,
        mode,
      };
      localStorage.setItem("mcq_app_state", JSON.stringify(data));
    } catch (err) {
      console.error("Failed to save app state", err);
    }
  }, [currentPage, questions, quizScore, mode]);

  // Called by Homepage when user chooses mode and document is processed
  // Updated to accept 'mode' and 'numQuestions' logic from Homepage
  const handleStartQuiz = (selectedMode: Mode, generatedQuestions: any[]) => {
    localStorage.removeItem("mcq_quiz_state"); // Clear previous in-progress answers

    setMode(selectedMode);
    setQuestions(generatedQuestions);
    setQuizScore(0);
    setQuizDetails([]);
    setCurrentPage("quiz");
  };

  // Called by MCQPage when quiz/practice is completed
  const handleQuizComplete = (score: number, details: QuestionResult[]) => {
    setQuizScore(score);
    setQuizDetails(details);
    setCurrentPage("results");
  };

  const handleReturnHome = () => {
    setCurrentPage("home");
    setQuestions([]);
    setQuizScore(0);
    setQuizDetails([]);
    // Clear persistence so we start fresh next time
    localStorage.removeItem("mcq_app_state");
    localStorage.removeItem("mcq_quiz_state");
  };

  return (
    <>
      {currentPage === "home" && (
        <Homepage onStartQuiz={handleStartQuiz} />
      )}

      {currentPage === "quiz" && (
        <MCQPage
          questions={questions}
          mode={mode} // Pass the selected mode
          onComplete={handleQuizComplete}
          onExit={handleReturnHome} // Kept this for the "Home" button
        />
      )}

      {currentPage === "results" && (
        <ResultsPage
          score={quizScore}
          totalQuestions={questions.length}
          details={quizDetails} // Pass details to results page
          onReturnHome={handleReturnHome}
        />
      )}
      <Toaster />
    </>
  );
}