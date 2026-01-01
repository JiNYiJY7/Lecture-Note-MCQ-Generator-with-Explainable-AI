import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Home, Clock, Send, User, Wifi, WifiOff } from "lucide-react";
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
  difficulty?: Difficulty | null;
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

type InternalResult = QuestionResult & {
  checked?: boolean;
  xaiLoading?: boolean;
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

export function MCQPage({ questions, onComplete, mode, onExit }: MCQPageProps) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);

  // 1. READ OFFLINE PREFERENCE
  const useOffline = localStorage.getItem("use_offline_mode") === "true";

  const [score, setScore] = useState(0);
  const [results, setResults] = useState<InternalResult[]>([]);
  const resultsRef = useRef<InternalResult[]>([]);
  useEffect(() => { resultsRef.current = results; }, [results]);

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
  const alreadyExplained = !!currentResult?.explanation && currentResult.explanation.trim().length > 0;

  const [chatInput, setChatInput] = useState("");

  const renderDifficultyBadge = (d?: Difficulty | null) => {
    if (!d) return null;
    const label = d.charAt(0).toUpperCase() + d.slice(1);
    const cls = d === "easy" ? "bg-green-50 text-green-700 border-green-200"
              : d === "medium" ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-red-50 text-red-700 border-red-200";
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${cls}`}>
        Difficulty: {label}
      </span>
    );
  };

  const chatBoxRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const onChatScroll = () => {
    const el = chatBoxRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const inFlightCheckRef = useRef<Record<number, Promise<any>>>({});
  const latestSelectionRef = useRef<Record<number, string>>({});

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const computeScoreFromResults = (res: InternalResult[]) =>
    res.reduce((acc, r) => acc + (r.checked && r.isCorrect ? 1 : 0), 0);

  useEffect(() => {
    const initial: InternalResult[] = questions.map((q) => ({
      questionId: q.id, stem: q.stem, options: q.options, selectedLabel: null, isCorrect: false, checked: false, correctLabel: undefined, explanation: "", xaiLoading: false, checkError: null,
    }));
    setResults(initial);
  }, [questions]);

  // Quiz timer
  useEffect(() => {
    if (mode !== "quiz") return;
    if (timeLeft <= 0) { if (!isFinishing) void finishQuiz(); return; }
    const timerId = setInterval(() => setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0)), 1000);
    return () => clearInterval(timerId);
  }, [mode, timeLeft, isFinishing]);

  // Auto-scroll
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
      const responseText = await api.sendChatMessage(String(currentQ.id), textToSend, useOffline);
      const aiMsg: ChatMessage = { id: Date.now() + 1, text: responseText, sender: "ai" };
      setChatMessages((prev) => [...prev, aiMsg]);
    } catch {
      setChatMessages((prev) => [...prev, { id: Date.now(), text: "Error connecting to AI.", sender: "ai" }]);
    } finally {
      setLoadingXAI(false);
    }
  };

  const runFastCheckForQuiz = (questionIndex: number, questionId: number, label: string) => {
    latestSelectionRef.current[questionId] = label;
    setResults((prev) => {
      const copy = [...prev]; copy[questionIndex] = { ...copy[questionIndex], selectedLabel: label, checked: false, checkError: null };
      return copy;
    });
    const p = api.checkAnswer(questionId, label);
    inFlightCheckRef.current[questionId] = p;
    p.then((chk: any) => {
      if (latestSelectionRef.current[questionId] !== label) return;
      setResults((prev) => {
        const copy = [...prev]; copy[questionIndex] = { ...copy[questionIndex], isCorrect: chk.is_correct, correctLabel: chk.correct_label, checked: true, checkError: null };
        return copy;
      });
    }).catch((err: any) => console.error(err));
  };

  const handleAnswerSelect = (label: string) => {
    setSelectedAnswer(label);
    const qid = currentQ.id;
    setResults((prev) => {
      const copy = [...prev];
      copy[currentQuestion] = { ...copy[currentQuestion], questionId: qid, stem: currentQ.stem, options: currentQ.options, selectedLabel: label };
      return copy;
    });
    if (mode === "quiz") runFastCheckForQuiz(currentQuestion, qid, label);
  };

  // ---------------------------
  // Learn mode: Check Answer
  // ---------------------------
  const handleAttempt = async () => {
    if (mode !== "learn" || !selectedAnswer || alreadyExplained) return;

    const label = selectedAnswer;
    const chosen = currentQ.options.find(o => o.label === label);
    const uiText = `I choose option ${label} (${chosen?.text}). Is this correct?`;
    const optionsBlock = JSON.stringify(currentQ.options);

    const apiPrompt = `Please use the explain_mcq_answer_tool to check my answer. My selected option is: "${label}". The question ID is: ${currentQ.id}. Options: ${optionsBlock}`;

    setChatMessages((prev) => [...prev, { id: Date.now(), text: uiText, sender: "user" }]);
    setLoadingXAI(true);

    try {
      const chk = await api.checkAnswer(currentQ.id, label);
      const isCorrect = !!chk?.is_correct;
      const correctLabel = chk?.correct_label ?? (isCorrect ? label : undefined);

      const aiResponseText = await api.sendChatMessage(String(currentQ.id), apiPrompt, useOffline);
      const aiResponse = aiResponseText || "";

      setResults((prev) => {
        const copy = [...prev];
        copy[currentQuestion] = { ...copy[currentQuestion], isCorrect, checked: true, correctLabel, explanation: aiResponse };
        return copy;
      });

      // ✅ FIX: Directly output the AI response without prepending "I selected option..."
      setChatMessages((prev) => [...prev, { id: Date.now() + 1, text: aiResponse.trim(), sender: "ai" }]);
    } catch (error) {
        setChatMessages((prev) => [...prev, { id: Date.now(), text: "Error connecting to AI Tutor.", sender: "ai" }]);
    } finally {
      setLoadingXAI(false);
    }
  };

  const fetchTutorExplanationForQuiz = async (questionIndex: number, questionId: number, label: string) => {
      const q = questions[questionIndex];
      setResults(prev => { const c = [...prev]; c[questionIndex].xaiLoading = true; return c; });
      try {
        const chk = await api.checkAnswer(questionId, label);
        const explanationData = await api.getExplanation(questionId, label);
        setResults(prev => {
           const c = [...prev];
           c[questionIndex] = { ...c[questionIndex], explanation: explanationData.reasoning, xaiLoading: false, isCorrect: chk.is_correct, checked: true, correctLabel: chk.correct_label };
           return c;
        });
      } catch {
         setResults(prev => { const c = [...prev]; c[questionIndex].xaiLoading = false; return c; });
      }
  };

  const finishQuiz = async () => {
      if (mode !== "quiz") {
          onComplete(computeScoreFromResults(resultsRef.current), resultsRef.current as any);
          return;
      }
      setIsFinishing(true);
      const snapshot = [...resultsRef.current];
      for (let i = 0; i < questions.length; i++) {
        const r = snapshot[i];
        if (r && r.selectedLabel) await fetchTutorExplanationForQuiz(i, r.questionId, r.selectedLabel);
      }
      onComplete(computeScoreFromResults(resultsRef.current), resultsRef.current as any);
      setIsFinishing(false);
  };

  const goToQuestion = (index: number) => {
      if (index < 0 || index >= questions.length) return;
      setCurrentQuestion(index);
      setSelectedAnswer(resultsRef.current[index]?.selectedLabel ?? null);
  };

  const handleNext = () => { if (currentQuestion < questions.length - 1) goToQuestion(currentQuestion + 1); else void finishQuiz(); };
  const handlePrevious = () => { if (currentQuestion > 0) goToQuestion(currentQuestion - 1); };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={onExit} className="gap-2 text-slate-600 hover:text-slate-900">
                    <Home className="w-4 h-4" /> Exit
                </Button>

                {/* OFFLINE STATUS BADGE */}
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border shadow-sm ${
                    useOffline
                    ? "bg-slate-100 text-slate-600 border-slate-200"
                    : "bg-green-50 text-green-700 border-green-200"
                }`}>
                    {useOffline
                        ? <><WifiOff className="w-3 h-3" /> Offline Mode</>
                        : <><Wifi className="w-3 h-3" /> Online Mode</>
                    }
                </div>
            </div>

            {mode === "quiz" && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium bg-white border border-slate-200 text-slate-700">
                <Clock className="w-4 h-4" /> {formatTime(timeLeft)}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                    {mode === "learn" ? "Practice Mode" : "Quiz Mode"}
                </span>
                {renderDifficultyBadge(currentQ?.difficulty)}
            </div>
            <span className="text-xs text-muted-foreground">Question {currentQuestion + 1} of {questions.length}</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <div className={`grid grid-cols-1 ${mode === "learn" ? "lg:grid-cols-3" : ""} gap-6`}>
           <div className="lg:col-span-2 flex flex-col h-[600px] space-y-6">
                <Card className="bg-white/80 backdrop-blur shadow-sm border-slate-200">
                    <CardHeader><CardTitle className="text-xl">Question {currentQuestion + 1}</CardTitle></CardHeader>
                    <CardContent><p className="text-lg leading-relaxed text-slate-800">{currentQ?.stem}</p></CardContent>
                </Card>
                <div className="flex-1 overflow-y-auto">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-fr">
                        {currentQ?.options?.map((option) => {
                            const active = selectedAnswer === option.label;
                            return (
                                <Card key={option.label} onClick={() => handleAnswerSelect(option.label)}
                                    className={`cursor-pointer transition-all hover:shadow-md ${active ? "ring-2 ring-primary bg-primary/5 border-primary" : "bg-white/90 border-slate-200"}`}>
                                    <CardContent className="p-5 flex items-start gap-4">
                                        <div className={`mt-0.5 w-9 h-9 rounded-full flex shrink-0 items-center justify-center font-semibold text-sm ${active ? "bg-primary text-primary-foreground" : "bg-slate-100 text-slate-700"}`}>{option.label}</div>
                                        <p className="text-slate-800 leading-snug">{option.text}</p>
                                    </CardContent>
                                </Card>
                            )
                        })}
                     </div>
                </div>
                <div className="flex justify-between pt-4 border-t border-slate-200/60">
                    <Button variant="ghost" size="lg" onClick={handlePrevious} disabled={currentQuestion === 0}>Previous</Button>
                    <div className="flex gap-3">
                        {mode === "learn" && <Button variant="secondary" size="lg" onClick={handleAttempt} disabled={!selectedAnswer || alreadyExplained || loadingXAI}>Check Answer</Button>}
                        <Button size="lg" onClick={handleNext} disabled={!selectedAnswer}>{currentQuestion < questions.length - 1 ? "Next" : "Finish"}</Button>
                    </div>
                </div>
           </div>

           {mode === "learn" ? (
               <div className="lg:col-span-1">
                   <Card className="h-[600px] flex flex-col bg-white/90 backdrop-blur shadow-xl border-primary/10 overflow-hidden">
                       <CardHeader className="bg-primary/5 border-b py-4"><CardTitle className="flex items-center gap-2 text-primary"><Bot className="w-5 h-5"/> AI Tutor</CardTitle></CardHeader>
                       <CardContent className="flex-1 min-h-0 flex flex-col p-0 overflow-hidden">
                           <div ref={chatBoxRef} onScroll={onChatScroll} className="flex-1 min-h-0 bg-slate-50/60 overflow-y-auto">
                                <div className="p-4 space-y-4">
                                    {chatMessages.map(msg => (
                                        <div key={msg.id} className={`flex items-end gap-2 ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                                            <div className={`relative max-w-[82%] px-4 py-3 text-sm shadow-sm rounded-2xl ${msg.sender === "user" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-white text-slate-800 border border-slate-200 rounded-bl-md"}`}>{msg.text}</div>
                                        </div>
                                    ))}
                                    {loadingXAI && <div className="text-xs text-slate-500 p-2">AI is thinking...</div>}
                                </div>
                           </div>
                           <div className="p-3 border-t bg-white">
                               <div className="flex items-center gap-2">
                                   <input className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                                          placeholder="Ask follow-up..." value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSendMessage()} disabled={loadingXAI}/>
                                   <Button size="icon" className="rounded-full" onClick={handleSendMessage} disabled={!chatInput.trim()}><Send className="w-4 h-4"/></Button>
                                </div>
                           </div>
                       </CardContent>
                   </Card>
               </div>
           ) : <div className="hidden lg:block lg:col-span-1 h-[600px]"/>}
        </div>
      </div>
    </div>
  );
}