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

type XAIExplainResponse = {
  is_correct: boolean;
  student_label: string;
  correct_label: string;
  reasoning: string;
};

type XAIChatResponse = {
  response: string;
};

function CheckingAnswersScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 flex items-center justify-center p-8">
      <div className="bg-white/80 backdrop-blur border border-slate-200 rounded-xl p-8 w-full max-w-lg text-center space-y-4">
        <div className="mx-auto h-10 w-10 rounded-full border-4 border-slate-300 border-t-slate-700 animate-spin" />
        <h2 className="text-xl font-semibold">Checking answers…</h2>
        <p className="text-slate-600 text-sm">
          Generating explanations for your results.
        </p>
      </div>
    </div>
  );
}

/** IMPORTANT: Use the same prefix as the rest of your app (/api/...) */
async function explainOneDBMode(
  questionId: number,
  studentLabel: string
): Promise<XAIExplainResponse> {
  const res = await fetch("/api/xai/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question_id: questionId,
      student_answer_label: studentLabel,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Explain failed (${res.status}): ${text || res.statusText}`);
  }

  return (await res.json()) as XAIExplainResponse;
}

/** Tutor-style explanation (same style as Learn mode): use /api/xai/chat */
async function tutorExplainOneChatMode(
  questionId: number,
  studentLabel: string,
  stem: string,
  options: { label: string; text: string }[]
): Promise<string> {
  const optionsBlock = JSON.stringify(options);

  const prompt = `
Please use the explain_mcq_answer_tool to check my answer and provide a detailed XAI explanation.

Requirements:
- Start with whether my choice is correct or incorrect (and state the correct option letter).
- Explain WHY in 2–4 short sentences.
- Mention the key concept/term being tested.

My selected option is: "${studentLabel}"
The full question is: "${stem}"
The options are: ${optionsBlock}
The question ID is: ${questionId}
  `.trim();

  const res = await fetch("/api/xai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: String(questionId),
      message: prompt,
      user_id: "student_1",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Chat failed (${res.status}): ${text || res.statusText}`);
  }

  const data = (await res.json()) as XAIChatResponse;
  return (data?.response ?? "").trim();
}

/** Small concurrency limiter (keeps it stable; avoids spam calling LLM) */
async function asyncPool<T, R>(
  poolLimit: number,
  array: T[],
  iteratorFn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const ret: Promise<R>[] = [];
  const executing: Promise<any>[] = [];

  for (let i = 0; i < array.length; i++) {
    const item = array[i];
    const p = Promise.resolve().then(() => iteratorFn(item, i));
    ret.push(p);

    if (poolLimit <= array.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= poolLimit) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.all(ret);
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const [mode, setMode] = useState<Mode>("quiz");
  const [questions, setQuestions] = useState<any[]>([]);
  const [quizScore, setQuizScore] = useState(0);
  const [quizDetails, setQuizDetails] = useState<QuestionResult[]>([]);
  const [checkingAnswers, setCheckingAnswers] = useState(false);

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
      }
    } catch (err) {
      console.error("Failed to restore app state", err);
    }
  }, []);

  useEffect(() => {
    try {
      const data = { currentPage, questions, quizScore, mode };
      localStorage.setItem("mcq_app_state", JSON.stringify(data));
    } catch (err) {
      console.error("Failed to save app state", err);
    }
  }, [currentPage, questions, quizScore, mode]);

  const handleStartQuiz = (selectedMode: Mode, generatedQuestions: any[]) => {
    localStorage.removeItem("mcq_quiz_state");

    setMode(selectedMode);
    setQuestions(generatedQuestions);
    setQuizScore(0);
    setQuizDetails([]);
    setCurrentPage("quiz");
  };

  /**
   * QUIZ MODE:
   * - DO NOT overwrite explanation with /xai/explain reasoning (template).
   * - Use /xai/explain only for correctness + correct_label.
   * - Use /xai/chat for tutor-style explanation (same as learn mode).
   */
  const fetchAllTutorExplanations = async (
    details: QuestionResult[]
  ): Promise<QuestionResult[]> => {
    // Limit concurrency to keep it stable (adjust 2~4 if you want)
    const CONCURRENCY = 3;

    return asyncPool(CONCURRENCY, details, async (q) => {
      // Unanswered
      if (!q.selectedLabel) {
        return {
          ...q,
          isCorrect: false,
          correctLabel: q.correctLabel,
          explanation: q.explanation?.trim() || "No answer selected for this question.",
        };
      }

      // 1) correctness & correct label (DB/structured)
      let isCorrect = q.isCorrect;
      let correctLabel = q.correctLabel;

      // Only call explain endpoint if correctLabel missing (saves calls)
      if (!correctLabel || !String(correctLabel).trim()) {
        try {
          const resp = await explainOneDBMode(q.questionId, q.selectedLabel);
          isCorrect = !!resp.is_correct;
          correctLabel = resp.correct_label;
        } catch (err) {
          console.error("explainOneDBMode failed for question:", q.questionId, err);
          // keep existing fields if explain fails
        }
      }

      // 2) tutor explanation (LLM/agent tool)
      let tutorExp = "";
      try {
        tutorExp = await tutorExplainOneChatMode(
          q.questionId,
          q.selectedLabel,
          q.stem,
          q.options
        );
      } catch (err) {
        console.error("tutorExplainOneChatMode failed for question:", q.questionId, err);
      }

      return {
        ...q,
        isCorrect,
        correctLabel,
        // ✅ IMPORTANT: explanation uses tutor-style response (learn-mode vibe)
        explanation: tutorExp.trim() || q.explanation?.trim() || "No explanation available for this question.",
      };
    });
  };

  const handleQuizComplete = async (score: number, details: QuestionResult[]) => {
    // Learn mode unchanged
    if (mode === "learn") {
      setQuizScore(score);
      setQuizDetails(details);
      setCurrentPage("results");
      return;
    }

    // Quiz mode: show waiting screen, then generate tutor-style explanations
    setCheckingAnswers(true);
    try {
      const explainedDetails = await fetchAllTutorExplanations(details);

      const finalScore = explainedDetails.reduce(
        (acc, q) => acc + (q.isCorrect ? 1 : 0),
        0
      );

      setQuizScore(finalScore);
      setQuizDetails(explainedDetails);
      setCurrentPage("results");
    } catch (err) {
      console.error("Failed to generate tutor explanations:", err);
      setQuizScore(score);
      setQuizDetails(details);
      setCurrentPage("results");
    } finally {
      setCheckingAnswers(false);
    }
  };

  const handleReturnHome = () => {
    setCurrentPage("home");
    setQuestions([]);
    setQuizScore(0);
    setQuizDetails([]);
    localStorage.removeItem("mcq_app_state");
    localStorage.removeItem("mcq_quiz_state");
  };

  if (checkingAnswers) {
    return (
      <>
        <CheckingAnswersScreen />
        <Toaster />
      </>
    );
  }

  return (
    <>
      {currentPage === "home" && <Homepage onStartQuiz={handleStartQuiz} />}

      {currentPage === "quiz" && (
        <MCQPage
          questions={questions}
          mode={mode}
          onComplete={handleQuizComplete}
          onExit={handleReturnHome}
        />
      )}

      {currentPage === "results" && (
        <ResultsPage
          score={quizScore}
          totalQuestions={questions.length}
          details={quizDetails}
          onReturnHome={handleReturnHome}
        />
      )}

      <Toaster />
    </>
  );
}
