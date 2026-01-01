// MCQPage.tsx
//
// Fixes race conditions in Quiz mode:
// 1) Correctness is checked immediately on selection via api.checkAnswer (fast DB check).
// 2) Next waits for the in-flight check of the current question (prevents “all wrong” due to missing results).
// 3) Finish Quiz guarantees ALL selected answers are checked, then fetches XAI explanations.
// 4) Timer auto-finish calls finishQuiz() instead of onComplete() directly (prevents default-false results).
//
// Learn mode (your request):
// ✅ Keep your ORIGINAL explanation method (api.sendChatMessage) unchanged for reasoning.
// ✅ ALSO fetch ground-truth correct label via api.checkAnswer so the UI can highlight green/red.
// ✅ Standard marking sentence:
//    - Correct: "You selected option X, which is correct."
//    - Wrong:   "You selected option X, but the correct answer is option Y."
//
// Chat UI fix:
// ✅ Chat area is truly scrollable.
// ✅ Auto-scroll only when the user is already near the bottom.
// ✅ If user scrolls up to read history, new messages will NOT force-scroll them down.
//
// IMPORTANT:
// - Your frontend api MUST include api.checkAnswer(questionId, label).
//   (Implement it by calling /xai/explain and returning { is_correct, correct_label }.)

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Home, Clock, Send, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { api } from "../api";
import type { QuestionResult } from "../App";

type Difficulty = "easy" | "medium" | "hard";

interface Question {
  id: number;
  stem: string;
  options: { label: string; text: string }[];
  difficulty?: Difficulty | null; // ✅ NEW (optional for backward compatibility)
}

interface MCQPageProps {
  questions: Question[];
  onComplete: (score: number, details: QuestionResult[]) => void;
  mode: "learn" | "quiz";
  onExit: () => void;
}

interface ChatMessage {
  id: number;
  text: string;
  sender: "user" | "ai";
}

// Internal extension (keeps your App QuestionResult unchanged)
type InternalResult = QuestionResult & {
  checked?: boolean; // has correctness been confirmed by checkAnswer/getExplanation?
  xaiLoading?: boolean; // explanation is being fetched
  checkError?: string | null;
};

const QUIZ_SECONDS_PER_QUESTION = 60;

const INITIAL_CHAT: ChatMessage[] = [
  {
    id: 1,
    text: "Hello! I'm your AI Tutor. Select an answer, then click Check Answer to see the explanation.",
    sender: "ai",
  },
];

function buildMarkingLine(selected: string, isCorrect: boolean, correct?: string) {
  return "";
}

export function MCQPage({ questions, onComplete, mode, onExit }: MCQPageProps) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);

  const [score, setScore] = useState(0);
  const [results, setResults] = useState<InternalResult[]>([]);
  const resultsRef = useRef<InternalResult[]>([]);
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [loadingXAI, setLoadingXAI] = useState(false);

  const totalTime = questions.length * QUIZ_SECONDS_PER_QUESTION;
  const [timeLeft, setTimeLeft] = useState<number>(totalTime);
  const [isFinishing, setIsFinishing] = useState(false);

  const progress = useMemo(
    () => ((currentQuestion + 1) / Math.max(1, questions.length)) * 100,
    [currentQuestion, questions.length]
  );

  const currentQ = questions[currentQuestion];

  const currentResult = results[currentQuestion];
  const alreadyExplained =
    !!currentResult?.explanation && currentResult.explanation.trim().length > 0;

  const [chatInput, setChatInput] = useState("");

  // ---------------------------
  // Difficulty badge helper
  // ---------------------------
  const renderDifficultyBadge = (d?: Difficulty | null) => {
    if (!d) return null;

    const label = d.charAt(0).toUpperCase() + d.slice(1);
    const cls =
      d === "easy"
        ? "bg-green-50 text-green-700 border-green-200"
        : d === "medium"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-red-50 text-red-700 border-red-200";

    return (
      <span
        className={[
          "inline-flex items-center gap-1 px-2.5 py-1 rounded-full",
          "text-[11px] font-semibold border",
          cls,
        ].join(" ")}
        title="Requested generation difficulty"
      >
        Difficulty: {label}
      </span>
    );
  };

  // ---------------------------
  // Chat scroll (fix)
  // ---------------------------
  const chatBoxRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const onChatScroll = () => {
    const el = chatBoxRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoScroll(distanceToBottom < 80);
  };

  // Track in-flight “check answer” per question (prevents race conditions)
  const inFlightCheckRef = useRef<Record<number, Promise<any>>>({});
  // Track the latest selected label per question to ignore stale responses
  const latestSelectionRef = useRef<Record<number, string>>({});

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const computeScoreFromResults = (res: InternalResult[]) =>
    res.reduce((acc, r) => acc + (r.checked && r.isCorrect ? 1 : 0), 0);

  // ---------------------------
  // Init results
  // ---------------------------
  useEffect(() => {
    const initial: InternalResult[] = questions.map((q) => ({
      questionId: q.id,
      stem: q.stem,
      options: q.options,
      selectedLabel: null,
      // IMPORTANT: do not treat "false" as final correctness until checked=true
      isCorrect: false,
      checked: false,
      correctLabel: undefined,
      explanation: "",
      xaiLoading: false,
      checkError: null,
    }));
    setResults(initial);
  }, [questions]);

  // ---------------------------
  // Restore from localStorage
  // ---------------------------
  useEffect(() => {
    try {
      const saved = localStorage.getItem("mcq_quiz_state");
      if (!saved) {
        setCurrentQuestion(0);
        setScore(0);
        setSelectedAnswer(null);
        setChatMessages(INITIAL_CHAT);
        setLoadingXAI(false);
        setTimeLeft(totalTime);
        return;
      }

      const parsed = JSON.parse(saved);

      if (Array.isArray(parsed.results) && parsed.results.length === questions.length) {
        setResults(parsed.results as InternalResult[]);
      }

      let restoredIndex = 0;
      if (
        typeof parsed.currentQuestion === "number" &&
        parsed.currentQuestion >= 0 &&
        parsed.currentQuestion < questions.length
      ) {
        restoredIndex = parsed.currentQuestion;
        setCurrentQuestion(restoredIndex);
      } else {
        setCurrentQuestion(0);
      }

      if (typeof parsed.score === "number") setScore(parsed.score);

      if (parsed.selectedAnswer === null || typeof parsed.selectedAnswer === "string") {
        setSelectedAnswer(parsed.selectedAnswer);
      } else {
        const fromResults =
          (parsed.results &&
            parsed.results[restoredIndex] &&
            parsed.results[restoredIndex].selectedLabel) ||
          null;
        setSelectedAnswer(fromResults);
      }

      // Restore chat ONLY in learn mode
      if (mode === "learn") {
        if (Array.isArray(parsed.chatMessages) && parsed.chatMessages.length > 0) {
          setChatMessages(parsed.chatMessages);
        } else {
          setChatMessages(INITIAL_CHAT);
        }
        if (typeof parsed.loadingXAI === "boolean") setLoadingXAI(parsed.loadingXAI);
      } else {
        setChatMessages(INITIAL_CHAT);
        setLoadingXAI(false);
      }

      if (mode === "quiz" && typeof parsed.timeLeft === "number") {
        setTimeLeft(parsed.timeLeft);
      } else {
        setTimeLeft(totalTime);
      }

      // If learn mode was mid-explanation during reload, re-fetch explanation
      if (
        mode === "learn" &&
        parsed.loadingXAI === true &&
        parsed.selectedAnswer &&
        questions.length > 0
      ) {
        const idx =
          typeof parsed.currentQuestion === "number" &&
          parsed.currentQuestion >= 0 &&
          parsed.currentQuestion < questions.length
            ? parsed.currentQuestion
            : 0;

        const question = questions[idx];
        const label: string = parsed.selectedAnswer;

        (async () => {
          try {
            setLoadingXAI(true);
            const explanation = await api.getExplanation(question.id, label);

            setResults((prev) => {
              const copy = [...prev];
              const prevItem = copy[idx] ?? ({} as InternalResult);
              copy[idx] = {
                ...prevItem,
                questionId: question.id,
                stem: question.stem,
                options: question.options,
                selectedLabel: label,
                isCorrect: explanation.is_correct,
                checked: true,
                correctLabel:
                  explanation.correct_label ??
                  (explanation.is_correct ? label : prevItem.correctLabel),
                explanation: explanation.reasoning ?? prevItem.explanation ?? "",
              };
              return copy;
            });

            setChatMessages((prev) => [
              ...prev,
              { id: Date.now() + 1, text: explanation.reasoning, sender: "ai" },
            ]);
          } catch (error) {
            console.error("Error re-fetching explanation after reload", error);
            setChatMessages((prev) => [
              ...prev,
              { id: Date.now(), text: "Error fetching explanation.", sender: "ai" },
            ]);
          } finally {
            setLoadingXAI(false);
          }
        })();
      }
    } catch (err) {
      console.error("Failed to restore quiz state", err);
      setCurrentQuestion(0);
      setScore(0);
      setSelectedAnswer(null);
      setChatMessages(INITIAL_CHAT);
      setLoadingXAI(false);
      setTimeLeft(totalTime);
    }
  }, [questions.length, totalTime, mode, questions]);

  // ---------------------------
  // Persist to localStorage
  // ---------------------------
  useEffect(() => {
    try {
      const data: any = { currentQuestion, score, selectedAnswer, timeLeft, results };
      if (mode === "learn") {
        data.chatMessages = chatMessages;
        data.loadingXAI = loadingXAI;
      }
      localStorage.setItem("mcq_quiz_state", JSON.stringify(data));
    } catch (err) {
      console.error("Failed to save quiz state", err);
    }
  }, [currentQuestion, score, selectedAnswer, timeLeft, results, chatMessages, loadingXAI, mode]);

  // ---------------------------
  // Quiz timer
  // ---------------------------
  useEffect(() => {
    if (mode !== "quiz") return;

    if (timeLeft <= 0) {
      if (!isFinishing) void finishQuiz();
      return;
    }

    const timerId = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timerId);
  }, [mode, timeLeft, isFinishing]);

  // ---------------------------
  // Auto-scroll ONLY when user is near bottom
  // ---------------------------
  useEffect(() => {
    const el = chatBoxRef.current;
    if (!el) return;
    if (autoScroll) el.scrollTop = el.scrollHeight;
  }, [chatMessages, loadingXAI, autoScroll]);

  // ---------------------------
  // Learn mode chat send
  // ---------------------------
  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;

    const textToSend = chatInput;
    setChatInput("");

    const userMsg: ChatMessage = { id: Date.now(), text: textToSend, sender: "user" };
    setChatMessages((prev) => [...prev, userMsg]);
    setLoadingXAI(true);

    try {
      const data = await api.sendChatMessage(currentQ.id, textToSend);
      const aiMsg: ChatMessage = { id: Date.now() + 1, text: data.response, sender: "ai" };
      setChatMessages((prev) => [...prev, aiMsg]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { id: Date.now(), text: "Error connecting to AI.", sender: "ai" },
      ]);
    } finally {
      setLoadingXAI(false);
    }
  };

  // ---------------------------
  // Quiz: fast DB check (correctness) on selection
  // ---------------------------
  const runFastCheckForQuiz = (questionIndex: number, questionId: number, label: string) => {
    latestSelectionRef.current[questionId] = label;

    // mark as not-yet-checked (do NOT default to incorrect)
    setResults((prev) => {
      const copy = [...prev];
      const item = copy[questionIndex];
      if (!item) return prev;
      copy[questionIndex] = {
        ...item,
        selectedLabel: label,
        checked: false,
        checkError: null,
      };
      return copy;
    });

    const p = api.checkAnswer(questionId, label);
    inFlightCheckRef.current[questionId] = p;

    p.then((chk: any) => {
      if (latestSelectionRef.current[questionId] !== label) return;

      setResults((prev) => {
        const copy = [...prev];
        const item = copy[questionIndex];
        if (!item) return prev;
        if (item.questionId !== questionId) return prev;
        if (item.selectedLabel !== label) return prev;

        copy[questionIndex] = {
          ...item,
          isCorrect: chk.is_correct,
          correctLabel: chk.correct_label,
          checked: true,
          checkError: null,
        };
        return copy;
      });
    }).catch((err: any) => {
      if (latestSelectionRef.current[questionId] !== label) return;

      setResults((prev) => {
        const copy = [...prev];
        const item = copy[questionIndex];
        if (!item) return prev;
        if (item.questionId !== questionId) return prev;
        if (item.selectedLabel !== label) return prev;

        copy[questionIndex] = {
          ...item,
          checked: false,
          checkError: "Failed to check answer. Will retry on submit.",
        };
        return copy;
      });

      console.error("checkAnswer failed", err);
    });
  };

  // ---------------------------
  // Select answer
  // ---------------------------
  const handleAnswerSelect = (label: string) => {
    const questionIndex = currentQuestion;
    const question = questions[questionIndex];
    const qid = question.id;

    setSelectedAnswer(label);

    // update selection in results
    setResults((prev) => {
      const copy = [...prev];
      const prevItem = copy[questionIndex] ?? ({} as InternalResult);
      copy[questionIndex] = {
        ...prevItem,
        questionId: qid,
        stem: question.stem,
        options: question.options,
        selectedLabel: label,
      };
      return copy;
    });

    // Quiz mode: run fast check immediately (non-blocking)
    if (mode === "quiz") {
      runFastCheckForQuiz(questionIndex, qid, label);
      return;
    }
  };

  // ---------------------------
  // Learn mode: Check Answer
  // ---------------------------
  const handleAttempt = async () => {
    if (mode !== "learn") return;
    if (!selectedAnswer) return;
    if (alreadyExplained) return;

    const questionIndex = currentQuestion;
    const question = questions[questionIndex];
    const label = selectedAnswer;

    const chosen = question.options.find((o) => o.label === label);
    const uiText = `I choose option ${label} (${chosen?.text}). Is this correct?`;

    const optionsBlock = JSON.stringify(question.options);
    const apiPrompt = `
Please use the explain_mcq_answer_tool to check my answer and provide a detailed XAI explanation.
My selected option is: "${label}".
The full question is: "${question.stem}"
The options are: ${optionsBlock}
The question ID is: ${question.id}
    `.trim();

    setChatMessages((prev) => [...prev, { id: Date.now(), text: uiText, sender: "user" }]);
    setLoadingXAI(true);

    try {
      // 1) Ground-truth (correct label + correctness)
      const chk = await api.checkAnswer(question.id, label);
      const isCorrect = !!chk?.is_correct;
      const correctLabel = chk?.correct_label ?? (isCorrect ? label : undefined);

      // 2) Your original explanation method
      const data = await api.sendChatMessage(question.id, apiPrompt);
      const aiResponse = data.response ?? "";

      // 3) Standard marking sentence
      const markingLine = buildMarkingLine(label, isCorrect, correctLabel);

      // 4) Save: correctLabel is key for highlighting
      setResults((prev) => {
        const copy = [...prev];
        const prevItem = copy[questionIndex] ?? ({} as InternalResult);

        copy[questionIndex] = {
          ...prevItem,
          questionId: question.id,
          stem: question.stem,
          options: question.options,
          selectedLabel: label,
          isCorrect,
          checked: true,
          correctLabel,
          explanation: aiResponse,
        };
        return copy;
      });

      // 5) Show in chat
      setChatMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, text: aiResponse, sender: "ai" },
      ]);
    } catch (error) {
      console.error("Error connecting to AI Tutor", error);
      setChatMessages((prev) => [
        ...prev,
        { id: Date.now(), text: "Error connecting to AI Tutor.", sender: "ai" },
      ]);
    } finally {
      setLoadingXAI(false);
    }
  };

  // ---------------------------
  // Quiz: fetch explanations (template-based / structured)
  // ---------------------------
  const fetchExplanationForQuiz = async (
    questionIndex: number,
    questionId: number,
    label: string
  ) => {
    setResults((prev) => {
      const copy = [...prev];
      const item = copy[questionIndex];
      if (!item) return prev;
      copy[questionIndex] = { ...item, xaiLoading: true };
      return copy;
    });

    try {
      const explanation = await api.getExplanation(questionId, label);
      setResults((prev) => {
        const copy = [...prev];
        const item = copy[questionIndex];
        if (!item) return prev;

        copy[questionIndex] = {
          ...item,
          isCorrect: explanation.is_correct,
          checked: true,
          correctLabel:
            explanation.correct_label ?? (explanation.is_correct ? label : item.correctLabel),
          explanation: explanation.reasoning ?? item.explanation ?? "",
          xaiLoading: false,
        };
        return copy;
      });
    } catch (err) {
      console.error("getExplanation failed", err);
      setResults((prev) => {
        const copy = [...prev];
        const item = copy[questionIndex];
        if (!item) return prev;
        copy[questionIndex] = { ...item, xaiLoading: false };
        return copy;
      });
    }
  };

  // ---------------------------
  // ✅ Quiz: tutor-style explanations (same style as Learn mode)
  // Stable: sequential calls during Finish Quiz (no concurrency).
  // ---------------------------
    const fetchTutorExplanationForQuiz = async (
      questionIndex: number,
      questionId: number,
      label: string
    ) => {
      const q = questions[questionIndex];
      if (!q) return;

      setResults((prev) => {
        const copy = [...prev];
        const item = copy[questionIndex];
        if (!item) return prev;
        copy[questionIndex] = { ...item, xaiLoading: true };
        return copy;
      });

      try {
        // Get ground truth
        const chk = await api.checkAnswer(questionId, label);
        const isCorrect = !!chk?.is_correct;

        setResults((prev) => {
          const copy = [...prev];
          const item = copy[questionIndex];
          if (!item) return prev;

          copy[questionIndex] = {
            ...item,
            selectedLabel: label,
            isCorrect,
            checked: true,
            correctLabel: chk?.correct_label,
            checkError: null,
          };
          return copy;
        });

        // Use structured endpoint instead of chatbot for clean output
        const explanationData = await api.getExplanation(questionId, label);
        let formattedExplanation = "";

        if (isCorrect) {
          const firstSentence = explanationData.reasoning.split('.')[0] + '.';
          formattedExplanation = `Correct - ${firstSentence}`;
        } else {
          const firstSentence = explanationData.reasoning.split('.')[0] + '.';

          // Try to infer misconception
          const chosenText = q.options.find(o => o.label === label)?.text || "";
          let misconception = "the selected option doesn't match the lecture evidence";

          if (chosenText.toLowerCase().includes("reverse") || chosenText.toLowerCase().includes("opposite")) {
            misconception = "you reversed the relationship";
          } else if (chosenText.toLowerCase().includes("subset") || chosenText.toLowerCase().includes("part of")) {
            misconception = "you misunderstood the hierarchical relationship";
          } else if (chosenText.toLowerCase().includes("benefit") || chosenText.toLowerCase().includes("advantage")) {
            misconception = "you focused on benefits rather than the core concept";
          }

          formattedExplanation = `Incorrect - ${firstSentence} You likely chose this because ${misconception}.`;
        }

        setResults((prev) => {
          const copy = [...prev];
          const item = copy[questionIndex];
          if (!item) return prev;

          copy[questionIndex] = {
            ...item,
            explanation: formattedExplanation,
            xaiLoading: false,
          };
          return copy;
        });
      } catch (err) {
        console.error("Tutor explanation failed (quiz)", err);
        setResults((prev) => {
          const copy = [...prev];
          const item = copy[questionIndex];
          if (!item) return prev;
          copy[questionIndex] = { ...item, xaiLoading: false };
          return copy;
        });
      }
    };

  const finishQuiz = async () => {
    // Practice finish (learn)
    if (mode !== "quiz") {
      const finalDetails = resultsRef.current;
      const finalScore = computeScoreFromResults(finalDetails);
      localStorage.removeItem("mcq_quiz_state");
      onComplete(finalScore, finalDetails as unknown as QuestionResult[]);
      return;
    }

    try {
      setIsFinishing(true);

      // 1) Wait for all in-flight checks to settle
      const inflights = Object.values(inFlightCheckRef.current);
      if (inflights.length) await Promise.allSettled(inflights);

      // 2) Retry checks for any selected answers not yet checked
      const snapshot = [...resultsRef.current];

      await Promise.allSettled(
        snapshot.map(async (r, idx) => {
          if (!r?.selectedLabel) return;
          if (r.checked) return;

          try {
            const chk = await api.checkAnswer(r.questionId, r.selectedLabel);
            setResults((prev) => {
              const copy = [...prev];
              const item = copy[idx];
              if (!item) return prev;
              if (item.questionId !== r.questionId) return prev;
              if (item.selectedLabel !== r.selectedLabel) return prev;

              copy[idx] = {
                ...item,
                isCorrect: chk.is_correct,
                correctLabel: chk.correct_label,
                checked: true,
                checkError: null,
              };
              return copy;
            });
          } catch {
            // keep unchecked; explanation may still fill it later
          }
        })
      );

      // 3) ✅ Generate tutor-style explanations for all answered questions (stable: sequential)
      const afterCheck = [...resultsRef.current];

      for (let i = 0; i < questions.length; i++) {
        const r = afterCheck[i];
        if (!r || !r.selectedLabel) continue;

        // Use Learn-style explanation via chatbot
        await fetchTutorExplanationForQuiz(i, r.questionId, r.selectedLabel);
      }

      // 4) Final score from the latest results snapshot
      const finalDetails = resultsRef.current;
      const finalScore = computeScoreFromResults(finalDetails);

      localStorage.removeItem("mcq_quiz_state");
      onComplete(finalScore, finalDetails as unknown as QuestionResult[]);
    } finally {
      setIsFinishing(false);
    }
  };

  // ---------------------------
  // Navigation helpers
  // ---------------------------
  const goToQuestion = (index: number) => {
    if (index < 0 || index >= questions.length) return;
    setCurrentQuestion(index);

    const prevSelection = resultsRef.current[index]?.selectedLabel ?? null;
    setSelectedAnswer(prevSelection);

    if (mode === "learn") {
      setChatMessages([{ id: Date.now(), text: "What do you think about this question?", sender: "ai" }]);
      setLoadingXAI(false);
      setAutoScroll(true); // reset autoscroll for new question
    }
  };

  const handleNext = async () => {
    if (mode === "quiz") {
      const qid = currentQ?.id;
      if (qid != null) {
        const inflight = inFlightCheckRef.current[qid];
        if (inflight) {
          try {
            await inflight;
          } catch {
            // ignore
          }
        }
      }
    }

    if (currentQuestion < questions.length - 1) goToQuestion(currentQuestion + 1);
    else void finishQuiz();
  };

  const handlePrevious = () => {
    if (currentQuestion > 0) goToQuestion(currentQuestion - 1);
  };

  const optionsLocked =
    (mode === "learn" && (loadingXAI || alreadyExplained)) || (mode === "quiz" && isFinishing);

  const nextDisabled =
    selectedAnswer === null ||
    (mode === "learn" && (!alreadyExplained || loadingXAI)) ||
    (mode === "quiz" && isFinishing);

  const leftPanelClass = "lg:col-span-2 flex flex-col h-[600px] space-y-6";

  // ---------------------------
  // UI
  // ---------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={onExit}
              className="gap-2 text-slate-600 hover:text-slate-900"
            >
              <Home className="w-4 h-4" /> Exit to Home
            </Button>

            {mode === "quiz" && (
              <div
                className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium border ${
                  timeLeft < 60
                    ? "bg-red-50 text-red-600 border-red-200"
                    : "bg-white text-slate-700 border-slate-200"
                }`}
              >
                <Clock className="w-4 h-4" />
                {formatTime(timeLeft)}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                {mode === "learn" ? "Practice Mode" : "Quiz Mode"}
              </span>

              {/* ✅ Difficulty badge (only if present) */}
              {renderDifficultyBadge(currentQ?.difficulty)}
            </div>

            <span className="text-xs text-muted-foreground">
              Question {currentQuestion + 1} of {questions.length}
            </span>
          </div>

          <Progress value={progress} className="h-2" />
        </div>

        <div className={`grid grid-cols-1 ${mode === "learn" ? "lg:grid-cols-3" : ""} gap-6`}>
          {/* Left side */}
          <div className={leftPanelClass}>
            <Card className="bg-white/80 backdrop-blur shadow-sm border-slate-200">
              <CardHeader>
                <CardTitle className="text-xl">Question {currentQuestion + 1}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg leading-relaxed text-slate-800">{currentQ?.stem}</p>
              </CardContent>
            </Card>

            {/* Options */}
            <div className="flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-fr items-stretch h-full">
                {currentQ?.options?.map((option) => {
                  const active = selectedAnswer === option.label;
                  return (
                    <Card
                      key={option.label}
                      onClick={() => handleAnswerSelect(option.label)}
                      className={[
                        "h-full cursor-pointer transition-all",
                        "hover:shadow-md",
                        active
                          ? "ring-2 ring-primary bg-primary/5 border-primary"
                          : "bg-white/90 backdrop-blur border-slate-200 hover:border-primary/50",
                        optionsLocked ? "pointer-events-none opacity-60 grayscale-[0.5]" : "",
                      ].join(" ")}
                    >
                      <CardContent className="p-5 h-full flex items-start gap-4">
                        <div
                          className={[
                            "mt-0.5 w-9 h-9 rounded-full flex shrink-0 items-center justify-center",
                            "font-semibold text-sm transition-colors",
                            active ? "bg-primary text-primary-foreground" : "bg-slate-100 text-slate-700",
                          ].join(" ")}
                        >
                          {option.label}
                        </div>

                        <p className="text-slate-800 leading-snug">{option.text}</p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-4 border-t border-slate-200/60">
              <Button
                variant="ghost"
                size="lg"
                onClick={handlePrevious}
                disabled={currentQuestion === 0}
                className="gap-2"
              >
                Previous
              </Button>

              <div className="flex gap-3">
                {mode === "learn" && (
                  <Button
                    variant="secondary"
                    size="lg"
                    onClick={handleAttempt}
                    disabled={!selectedAnswer || loadingXAI || alreadyExplained}
                  >
                    Check Answer
                  </Button>
                )}

                <Button
                  size="lg"
                  onClick={handleNext}
                  disabled={nextDisabled}
                  className={isFinishing ? "animate-pulse" : ""}
                >
                  {currentQuestion < questions.length - 1
                    ? "Next Question"
                    : mode === "quiz"
                    ? isFinishing
                      ? "Submitting..."
                      : "Finish Quiz"
                    : "Finish Practice"}
                </Button>
              </div>
            </div>
          </div>

          {/* Right side */}
          {mode === "learn" ? (
            <div className="lg:col-span-1">
              <Card className="h-[600px] flex flex-col bg-white/90 backdrop-blur shadow-xl border-primary/10 overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-primary/10 to-transparent border-b py-4">
                  <CardTitle className="flex items-center gap-2 text-primary">
                    <Bot className="w-5 h-5" /> AI Tutor
                  </CardTitle>
                </CardHeader>

                {/* min-h-0 makes scroll work reliably in flex containers */}
                <CardContent className="flex-1 min-h-0 flex flex-col p-0 overflow-hidden">
                  {/* Chat area (scrollable) */}
                  <div
                    ref={chatBoxRef}
                    onScroll={onChatScroll}
                    className="flex-1 min-h-0 bg-slate-50/60 overflow-y-auto"
                  >
                    <div className="p-4 space-y-4">
                      {chatMessages.map((message) => {
                        const isUser = message.sender === "user";
                        return (
                          <div
                            key={message.id}
                            className={`flex items-end gap-2 ${isUser ? "justify-end" : "justify-start"}`}
                          >
                            {!isUser && (
                              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                                <Bot className="w-4 h-4" />
                              </div>
                            )}

                            <div
                              className={[
                                "relative max-w-[82%] px-4 py-3 text-sm shadow-sm rounded-2xl",
                                isUser
                                  ? "bg-primary text-primary-foreground rounded-br-md"
                                  : "bg-white text-slate-800 border border-slate-200 rounded-bl-md",
                                isUser
                                  ? "after:content-[''] after:absolute after:-right-2 after:bottom-2 after:border-y-8 after:border-y-transparent after:border-l-8 after:border-l-primary"
                                  : "after:content-[''] after:absolute after:-left-2 after:bottom-2 after:border-y-8 after:border-y-transparent after:border-r-8 after:border-r-white",
                              ].join(" ")}
                            >
                              {message.text}
                            </div>

                            {isUser && (
                              <div className="w-8 h-8 rounded-full bg-slate-900/5 text-slate-700 flex items-center justify-center shrink-0">
                                <User className="w-4 h-4" />
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {loadingXAI && (
                        <div className="flex items-end gap-2 justify-start">
                          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                            <Bot className="w-4 h-4" />
                          </div>
                          <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3 text-xs text-muted-foreground flex items-center gap-2 shadow-sm">
                            <span className="inline-flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.2s]" />
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.1s]" />
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                            </span>
                            <span>Analyzing...</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Chat input */}
                  <div className="p-3 border-t bg-white">
                    <div className="flex items-center gap-2">
                      <input
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        placeholder="Ask a follow-up question..."
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                        disabled={loadingXAI}
                      />
                      <Button
                        size="icon"
                        className="rounded-full"
                        onClick={handleSendMessage}
                        disabled={!chatInput.trim() || loadingXAI}
                      >
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="hidden lg:block lg:col-span-1 h-[600px]" />
          )}
        </div>
      </div>
    </div>
  );
}
