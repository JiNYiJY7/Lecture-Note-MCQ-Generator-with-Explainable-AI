import { useEffect, useState, useRef } from "react";
import { Bot, Home, Clock, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { ScrollArea } from "./ui/scroll-area";
import { api } from "../api";
import type { QuestionResult } from "../App";

interface Question {
  id: number;
  stem: string;
  options: { label: string; text: string }[];
}

interface MCQPageProps {
  questions: Question[];
  onComplete: (score: number, details: QuestionResult[]) => void;
  mode: "learn" | "quiz";
  onExit: () => void; // Restored Home button prop
}

interface ChatMessage {
  id: number;
  text: string;
  sender: "user" | "ai";
}

const QUIZ_SECONDS_PER_QUESTION = 60;

const INITIAL_CHAT: ChatMessage[] = [
  {
    id: 1,
    text: "Hello! I'm your AI Tutor. Select an answer, then click Attempt to see the explanation.",
    sender: "ai",
  },
];

export function MCQPage({ questions, onComplete, mode, onExit }: MCQPageProps) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);

  // For Learn Mode UI; Quiz Mode score is recomputed from results on submit
  const [score, setScore] = useState(0);

  // Per-question results to show on ResultsPage
  const [results, setResults] = useState<QuestionResult[]>([]);

  // Learn Mode chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [loadingXAI, setLoadingXAI] = useState(false);

  // Quiz Mode timer and "finishing" flag
  const totalTime = questions.length * QUIZ_SECONDS_PER_QUESTION;
  const [timeLeft, setTimeLeft] = useState<number>(totalTime);
  const [isFinishing, setIsFinishing] = useState(false);

  const progress = ((currentQuestion + 1) / questions.length) * 100;
  const currentQ = questions[currentQuestion];

  const currentResult = results[currentQuestion];
  const alreadyExplained =
    !!currentResult?.explanation &&
    currentResult.explanation.trim().length > 0;

  // --- Chat Input State ---
  const [chatInput, setChatInput] = useState("");

  // --- Chat Handler Function ---
  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;

    const textToSend = chatInput;
    setChatInput(""); // Clear input immediately

    // 1. Add User Message to UI
    const userMsg: ChatMessage = { id: Date.now(), text: textToSend, sender: "user" };
    setChatMessages(prev => [...prev, userMsg]);
    setLoadingXAI(true);

    try {
        // 2. Call the Real Backend Agent
        // Use question.id as session_id so each question has its own chat history
        const data = await api.sendChatMessage(currentQ.id, textToSend);

        // 3. Add AI Response to UI
        const aiMsg: ChatMessage = { id: Date.now() + 1, text: data.response, sender: "ai" };
        setChatMessages(prev => [...prev, aiMsg]);
    } catch (err) {
        setChatMessages(prev => [...prev, { id: Date.now(), text: "Error connecting to AI.", sender: "ai" }]);
    } finally {
        setLoadingXAI(false);
    }
  };

  // ---------- Helpers ----------

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const computeScoreFromResults = (res: QuestionResult[]) =>
    res.reduce((acc, r) => acc + (r.isCorrect ? 1 : 0), 0);

  // ---------- Initialize results when questions change ----------

  useEffect(() => {
    const initial: QuestionResult[] = questions.map((q) => ({
      questionId: q.id,
      stem: q.stem,
      options: q.options,
      selectedLabel: null,
      isCorrect: false,
      correctLabel: undefined,
      explanation: "",
    }));
    setResults(initial);
  }, [questions]);

  // ---------- Restore state from localStorage (for reload) ----------

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

      // Restore results (so that previous answers are shown after reload)
      if (Array.isArray(parsed.results) && parsed.results.length === questions.length) {
        setResults(parsed.results as QuestionResult[]);
      }

      // Question index
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

      // Score (used mainly in Learn Mode)
      if (typeof parsed.score === "number") setScore(parsed.score);

      // Current selected answer for that question
      if (
        parsed.selectedAnswer === null ||
        typeof parsed.selectedAnswer === "string"
      ) {
        setSelectedAnswer(parsed.selectedAnswer);
      } else {
        const fromResults =
          (parsed.results &&
            parsed.results[restoredIndex] &&
            parsed.results[restoredIndex].selectedLabel) ||
          null;
        setSelectedAnswer(fromResults);
      }

      // Learn Mode: restore chat and loading flag
      if (mode === "learn") {
        if (Array.isArray(parsed.chatMessages) && parsed.chatMessages.length > 0) {
          setChatMessages(parsed.chatMessages);
        } else {
          setChatMessages(INITIAL_CHAT);
        }
        if (typeof parsed.loadingXAI === "boolean") {
          setLoadingXAI(parsed.loadingXAI);
        }
      } else {
        setChatMessages(INITIAL_CHAT);
        setLoadingXAI(false);
      }

      // Quiz Mode: continue timer; Learn Mode: reset timer
      if (mode === "quiz" && typeof parsed.timeLeft === "number") {
        setTimeLeft(parsed.timeLeft);
      } else {
        setTimeLeft(totalTime);
      }

      // Learn Mode: if we reloaded while explanation was still "Thinking...",
      // automatically re-fetch the explanation.
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

            if (explanation.is_correct) {
              setScore((prev) => prev + 1);
            }

            setResults((prev) => {
              const copy = [...prev];
              const prevItem = copy[idx] ?? {
                questionId: question.id,
                stem: question.stem,
                options: question.options,
                selectedLabel: label,
              };
              copy[idx] = {
                ...prevItem,
                questionId: question.id,
                stem: question.stem,
                options: question.options,
                selectedLabel: label,
                isCorrect: explanation.is_correct,
                correctLabel:
                  explanation.correct_label ??
                  (explanation.is_correct ? label : prevItem.correctLabel),
                explanation: explanation.reasoning ?? prevItem.explanation,
              } as QuestionResult;
              return copy;
            });

            const aiMsg: ChatMessage = {
              id: Date.now() + 1,
              text: explanation.reasoning,
              sender: "ai",
            };
            setChatMessages((prev) => [...prev, aiMsg]);
          } catch (error) {
            console.error("Error re-fetching explanation after reload", error);
            setChatMessages((prev) => [
              ...prev,
              {
                id: Date.now(),
                text: "Error fetching explanation.",
                sender: "ai",
              },
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

  // ---------- Persist state to localStorage (including results) ----------

  useEffect(() => {
    try {
      const data: any = {
        currentQuestion,
        score,
        selectedAnswer,
        timeLeft,
        results,
      };
      if (mode === "learn") {
        data.chatMessages = chatMessages;
        data.loadingXAI = loadingXAI;
      }
      localStorage.setItem("mcq_quiz_state", JSON.stringify(data));
    } catch (err) {
      console.error("Failed to save quiz state", err);
    }
  }, [
    currentQuestion,
    score,
    selectedAnswer,
    timeLeft,
    results,
    chatMessages,
    loadingXAI,
    mode,
  ]);

  // ---------- Quiz Mode timer (no reset on reload) ----------

  useEffect(() => {
    if (mode !== "quiz") return;

    if (timeLeft <= 0) {
      localStorage.removeItem("mcq_quiz_state");
      const finalScore = computeScoreFromResults(results);
      onComplete(finalScore, results);
      return;
    }

    const timerId = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timerId);
  }, [mode, timeLeft, onComplete, results]);

  // Auto-scroll to bottom when chat messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, loadingXAI]);

  // ---------- Answer selection (no explanation here in Learn Mode) ----------

  const handleAnswerSelect = (label: string) => {
    const questionIndex = currentQuestion;
    const question = questions[questionIndex];

    // Update local selection for this question
    setSelectedAnswer(label);

    // Record selection in results (last choice wins)
    setResults((prev) => {
      const copy = [...prev];
      const prevItem = copy[questionIndex] ?? {
        questionId: question.id,
        stem: question.stem,
        options: question.options,
      };
      copy[questionIndex] = {
        ...prevItem,
        questionId: question.id,
        stem: question.stem,
        options: question.options,
        selectedLabel: label,
      } as QuestionResult;
      return copy;
    });

    // Quiz Mode: explanation will be fetched later on submit
    if (mode === "quiz") {
      return;
    }

    // Learn Mode: we only select answer here; explanation will be triggered by Attempt button
  };

  const scrollRef = useRef<HTMLDivElement>(null);

  // ---------- Learn Mode: Attempt button (Talks to Chat Agent) ----------

  const handleAttempt = async () => {
    if (mode !== "learn") return;
    if (!selectedAnswer) return;
    if (alreadyExplained) return;

    const questionIndex = currentQuestion;
    const question = questions[questionIndex];
    const label = selectedAnswer;

    // 1. Prepare the messages
    const chosen = question.options.find((o) => o.label === label);

    // A. What the USER sees in the chat bubble (Clean & Simple)
    const uiText = `I choose option ${label} (${chosen?.text}). Is this correct?`;

    // B. What the AI receives (Hidden & Technical)
    const optionsBlock = JSON.stringify(question.options);
    const apiPrompt = `
      Please use the explain_mcq_answer_tool to check my answer and provide a detailed XAI explanation.
      My selected option is: "${label}".
      The full question is: "${question.stem}"
      The options are: ${optionsBlock}
      The question ID is: ${question.id}
      The lecture text is: "..." (If you store lecture text, include it here)
    `;

    // 2. Add only the CLEAN message to the UI
    const userMsg: ChatMessage = {
      id: Date.now(),
      text: uiText, // <--- CHANGED THIS
      sender: "user",
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setLoadingXAI(true);

    try {
      // 3. Send the HIDDEN technical prompt to the backend
      const data = await api.sendChatMessage(question.id, apiPrompt); // <--- SENDING COMPLEX PROMPT
      const aiResponse = data.response;

      // 4. Infer "Correctness"
      const isCorrectLower = aiResponse.toLowerCase();
      const inferredIsCorrect =
        (isCorrectLower.includes("correct") && !isCorrectLower.includes("incorrect")) ||
        isCorrectLower.startsWith("yes") ||
        isCorrectLower.includes("that is correct");

      if (inferredIsCorrect) {
        setScore((prev) => prev + 1);
      }

      // 5. Update Results State
      setResults((prev) => {
        const copy = [...prev];
        const prevItem = copy[questionIndex] ?? {
            questionId: question.id,
            stem: question.stem,
            options: question.options,
            selectedLabel: label,
        };

        copy[questionIndex] = {
          ...prevItem,
          questionId: question.id,
          stem: question.stem,
          options: question.options,
          selectedLabel: label,
          isCorrect: inferredIsCorrect,
          correctLabel: inferredIsCorrect ? label : undefined,
          explanation: aiResponse,
        } as QuestionResult;
        return copy;
      });

      // 6. Add AI Response to Chat UI
      const aiMsg: ChatMessage = {
        id: Date.now() + 1,
        text: aiResponse,
        sender: "ai",
      };
      setChatMessages((prev) => [...prev, aiMsg]);

    } catch (error) {
      console.error("Error connecting to AI Tutor", error);
      setChatMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          text: "Error connecting to AI Tutor.",
          sender: "ai",
        },
      ]);
    } finally {
      setLoadingXAI(false);
    }
  };

  // ---------- Finish quiz (different for learn vs quiz) ----------

  const finishQuiz = async () => {
    if (mode === "quiz") {
      // Mark all answered questions now, so user speed does not matter
      try {
        setIsFinishing(true);

        const updatedResults: QuestionResult[] = [...results];

        for (let i = 0; i < questions.length; i++) {
          const res = updatedResults[i];
          if (!res || !res.selectedLabel) {
            // Unanswered question – skip
            continue;
          }

          try {
            const explanation = await api.getExplanation(
              questions[i].id,
              res.selectedLabel
            );

            updatedResults[i] = {
              ...res,
              isCorrect: explanation.is_correct,
              correctLabel:
                explanation.correct_label ??
                (explanation.is_correct ? res.selectedLabel : res.correctLabel),
              explanation: explanation.reasoning ?? res.explanation ?? "",
            };
          } catch (error) {
            console.error("Error marking quiz question", i, error);
            // keep previous data; explanation may stay empty if API failed
          }
        }

        const finalScore = computeScoreFromResults(updatedResults);
        localStorage.removeItem("mcq_quiz_state");
        onComplete(finalScore, updatedResults);
      } finally {
        setIsFinishing(false);
      }
      return;
    }

    // Learn Mode: explanations already fetched per question
    const finalScore = computeScoreFromResults(results);
    localStorage.removeItem("mcq_quiz_state");
    onComplete(finalScore, results);
  };

  // ---------- Navigation (Next + Previous) ----------

  const goToQuestion = (index: number) => {
    if (index < 0 || index >= questions.length) return;
    setCurrentQuestion(index);

    // Restore previously selected answer for that question (if any)
    const prevSelection = results[index]?.selectedLabel ?? null;
    setSelectedAnswer(prevSelection);

    if (mode === "learn") {
      // When switching questions, show a neutral prompt again
      setChatMessages([
        {
          id: Date.now(),
          text: "What do you think about this question?",
          sender: "ai",
        },
      ]);
      setLoadingXAI(false);
    }
  };

  const handleNext = () => {
    if (currentQuestion < questions.length - 1) {
      goToQuestion(currentQuestion + 1);
    } else {
      void finishQuiz();
    }
  };

  const handlePrevious = () => {
    if (currentQuestion > 0) {
      goToQuestion(currentQuestion - 1);
    }
  };

  // In Learn Mode:
  // - options are locked only AFTER explanation is available (alreadyExplained) or while loading
  // In Quiz Mode:
  // - options never lock; last selection wins.
  const optionsLocked =
    mode === "learn" && (loadingXAI || alreadyExplained);

  // Learn Mode: disable Next until explanation has been shown for this question
  const nextDisabled =
    selectedAnswer === null ||
    (mode === "learn" && (!alreadyExplained || loadingXAI)) ||
    (mode === "quiz" && isFinishing);

  // ---------- Render ----------

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 space-y-2">

          {/* Top Bar with Home and Timer */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={onExit} className="gap-2 text-slate-600 hover:text-slate-900">
               <Home className="w-4 h-4" /> Exit to Home
            </Button>

            {mode === "quiz" && (
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium border ${timeLeft < 60 ? "bg-red-50 text-red-600 border-red-200" : "bg-white text-slate-700 border-slate-200"}`}>
                    <Clock className="w-4 h-4" />
                    {formatTime(timeLeft)}
                </div>
            )}
          </div>

          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
              {mode === "learn" ? "Practice Mode" : "Quiz Mode"}
            </span>
            <span className="text-xs text-muted-foreground">
                Question {currentQuestion + 1} of {questions.length}
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left side: question + options */}
          <div
            className={`${
              mode === "learn" ? "lg:col-span-2" : "lg:col-span-3"
            } space-y-6`}
          >
            <Card className="bg-white/80 backdrop-blur shadow-sm border-slate-200">
              <CardHeader>
                <CardTitle className="text-xl">Question {currentQuestion + 1}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg leading-relaxed text-slate-800">{currentQ.stem}</p>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {currentQ.options.map((option) => (
                <Card
                  key={option.label}
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    selectedAnswer === option.label
                      ? "ring-2 ring-primary bg-primary/5 border-primary"
                      : "bg-white/90 backdrop-blur border-slate-200 hover:border-primary/50"
                  } ${optionsLocked ? "pointer-events-none opacity-60 grayscale-[0.5]" : ""}`}
                  onClick={() => handleAnswerSelect(option.label)}
                >
                  <CardContent className="p-5 flex items-start gap-4">
                    <div
                      className={`w-8 h-8 rounded-full flex shrink-0 items-center justify-center font-semibold text-sm transition-colors ${
                        selectedAnswer === option.label
                          ? "bg-primary text-primary-foreground"
                          : "bg-slate-100 text-slate-600 group-hover:bg-slate-200"
                      }`}
                    >
                      {option.label}
                    </div>
                    <p className="mt-1 text-slate-700">{option.text}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Navigation buttons: Previous + Attempt (Learn) + Next / Finish */}
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
                    disabled={
                      !selectedAnswer || loadingXAI || alreadyExplained
                    }
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

          {/* Right side: AI Tutor panel (Learn Mode only) */}
          {mode === "learn" && (
            <div className="lg:col-span-1">
              <Card className="h-[600px] flex flex-col bg-white/90 backdrop-blur shadow-xl border-primary/10">
                <CardHeader className="bg-gradient-to-r from-primary/5 to-transparent border-b py-4">
                  <CardTitle className="flex items-center gap-2 text-primary">
                    <Bot className="w-5 h-5" /> AI Tutor
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-4 p-4 overflow-hidden bg-slate-50/30">
                  <ScrollArea className="flex-1 pr-4">
                    <div className="space-y-4">
                      {chatMessages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex ${
                            message.sender === "user"
                              ? "justify-end"
                              : "justify-start"
                          }`}
                        >
                          <div
                            className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                              message.sender === "user"
                                ? "bg-primary text-primary-foreground rounded-br-none"
                                : "bg-white text-slate-700 border border-slate-200 rounded-bl-none"
                            }`}
                          >
                            {message.text}
                          </div>
                        </div>
                      ))}
                      {loadingXAI && (
                         <div className="flex justify-start">
                            <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-none px-4 py-3 text-xs text-muted-foreground flex items-center gap-2">
                                <Bot className="w-3 h-3 animate-bounce" />
                                Analyzing...
                            </div>
                        </div>
                      )}
                      <div ref={scrollRef} />
                    </div>
                  </ScrollArea>

                  {/* --- Chat Input Area --- */}
                  <div className="flex gap-2 pt-2 border-t border-slate-200">
                    <input
                        className="flex-1 bg-white border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        placeholder="Ask a follow-up question..."
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                        disabled={loadingXAI}
                    />
                    <Button
                        size="icon"
                        onClick={handleSendMessage}
                        disabled={!chatInput.trim() || loadingXAI}
                    >
                        <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}