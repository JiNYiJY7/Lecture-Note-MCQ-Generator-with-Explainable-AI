import { useState, useEffect, useRef } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import {
  Upload, BookOpen, MoreVertical, Settings, Trash2,
  GraduationCap, Brain, Trophy, FileText, Play, Loader2, Calendar, Wifi, WifiOff
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { api } from "../api";
import { Mode } from "../App";

interface HomepageProps {
  onStartQuiz: (mode: Mode, questions: any[]) => void;
}

type DifficultyChoice = "mixed" | "easy" | "medium" | "hard";

export function Homepage({ onStartQuiz }: HomepageProps) {
  // --- STATE MANAGEMENT ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [quizzes, setQuizzes] = useState<any[]>([]);

  // Settings
  const [mode, setMode] = useState<Mode>("learn");
  const [difficulty, setDifficulty] = useState<DifficultyChoice>("mixed");
  const [numQuestions, setNumQuestions] = useState<string>("10");
  const [customQuestions, setCustomQuestions] = useState<string>("");

  // UI State
  const [isDragging, setIsDragging] = useState(false);

  // ✅ Offline Mode State
  const [useOffline, setUseOffline] = useState(() => {
    return localStorage.getItem("use_offline_mode") === "true";
  });

  // ✅ NEW: Toast State for Feedback
  const [toast, setToast] = useState<{ show: boolean; message: string; type: "online" | "offline" }>({
    show: false,
    message: "",
    type: "online"
  });

  // Sync Offline Mode to LocalStorage
  useEffect(() => {
    localStorage.setItem("use_offline_mode", String(useOffline));
  }, [useOffline]);

  // ✅ NEW: Auto-hide toast logic
  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast.show]);

  // ✅ NEW: Toggle Handler with Feedback
  const toggleOfflineMode = () => {
    const newValue = !useOffline;
    setUseOffline(newValue);
    setToast({
      show: true,
      message: newValue ? "Switched to Offline Mode (Llama 3.2)" : "Switched to Online Mode (DeepSeek)",
      type: newValue ? "offline" : "online"
    });
  };

  // --- INITIAL LOAD ---
  useEffect(() => {
    loadQuizzes();
  }, []);

  const loadQuizzes = async () => {
    try {
      const data = await api.getLectures();
      setQuizzes(data);
    } catch (err) {
      console.error("Failed to load quizzes:", err);
    }
  };

  // --- HELPER LOGIC ---
  const clamp = (v: number, min: number, max: number) => {
    if (Number.isNaN(v)) return min;
    return Math.max(min, Math.min(max, v));
  };

  const getValidQuestionCount = (): number | null => {
    let raw = numQuestions === "custom" ? customQuestions : numQuestions;
    const n = parseInt(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return clamp(n, 1, 50);
  };

  // --- CORE ACTIONS ---
  const processFile = async (file: File) => {
    const count = getValidQuestionCount();
    if (!count) {
      alert("Please enter a valid number of questions (1-50).");
      return;
    }

    setLoading(true);
    try {
      const doc = await api.uploadDocument(file);

      // Generate MCQs
      const mcqData = await api.generateMCQs(doc.id, count, difficulty, useOffline);

      const questionsWithIds = mcqData.questions.map((q: any, i: number) => ({
        ...q,
        id: mcqData.question_ids[i],
      }));

      await loadQuizzes(); // Refresh list
      onStartQuiz(mode, questionsWithIds);
    } catch (err: any) {
      if (err.message === "ONLINE_FAILED_SUGGEST_OFFLINE") {
         alert("Online service is busy. Please try enabling Offline Mode in settings (currently hidden).");
      } else {
         alert("Error: " + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleQuizSelect = async (lectureId: number) => {
    const count = getValidQuestionCount() || 10;
    setLoading(true);
    try {
      const questions = await api.getQuizQuestions(lectureId);
      if (questions.length === 0) {
        alert("No questions found for this lecture.");
      } else {
        // Slice to requested amount if needed, or take all
        const limitedQuestions = questions.slice(0, count);
        onStartQuiz(mode, limitedQuestions);
      }
    } catch (err: any) {
      alert("Failed to load quiz: " + err.message);
    } finally {
      setLoading(false);
    }
  };

//   const handleQuizSelect = async (lectureId: number) => {
//     // 1. Get the count from your settings
//     const count = getValidQuestionCount() || 10;
//     setLoading(true);
//
//     try {
//       // ✅ UPDATED: Generate NEW questions using your settings (Difficulty, Offline Mode)
//       // instead of just fetching old ones.
//       const data = await api.generateMCQs(lectureId, count, difficulty, useOffline);
//
//       if (data.questions) {
//         // Map the IDs returned by the backend so the Frontend can track them
//         const questionsWithIds = data.questions.map((q: any, i: number) => ({
//           ...q,
//           id: data.question_ids ? data.question_ids[i] : Math.random(),
//         }));
//
//         onStartQuiz(mode, questionsWithIds);
//       }
//     } catch (err: any) {
//       // Handle the specific error if Online mode is busy
//       if (err.message?.includes("ONLINE_FAILED_SUGGEST_OFFLINE")) {
//          alert("Online service is busy. Please switch to Offline Mode in the settings.");
//       } else {
//          alert("Failed to generate quiz: " + (err.message || "Unknown error"));
//       }
//     } finally {
//       setLoading(false);
//     }
//   };

  const handleDelete = async (lectureId: number) => {
    if (!confirm("Are you sure you want to delete this quiz?")) return;
    try {
      await api.deleteLecture(lectureId);
      setQuizzes((prev) => prev.filter((q) => q.id !== lectureId));
    } catch (err: any) {
      alert("Failed to delete: " + err.message);
    }
  };

  // --- EVENT HANDLERS ---
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processFile(file);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-cyan-50 to-blue-100 relative">

      {/* ✅ NEW: Toast Notification Component (Fixed Position) */}
      {toast.show && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div className="bg-slate-900/90 backdrop-blur text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 border border-slate-700/50">
            <div className={`p-1 rounded-full ${toast.type === "online" ? "bg-green-500/20 text-green-400" : "bg-slate-500/20 text-slate-400"}`}>
               {toast.type === "online" ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
            </div>
            <div className="flex flex-col">
                <span className="text-sm font-semibold">{toast.type === "online" ? "Online Mode" : "Offline Mode"}</span>
                <span className="text-xs text-slate-300">{toast.message}</span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-blue-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-blue-500 to-cyan-600 p-2.5 rounded-xl shadow-md">
                <GraduationCap className="size-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-800">LN-MCQ</h1>
                <p className="text-sm text-slate-500">Master any subject with AI-powered quizzes</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* Settings Control Panel */}
        <Card className="mb-8 border-blue-200 bg-white/90 backdrop-blur-sm shadow-lg">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-slate-800">
              <Settings className="size-5 text-blue-600" />
              Quiz Settings
            </CardTitle>
            <CardDescription>Customize your learning experience before generating or starting</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Mode Selection */}
            <div className="space-y-2">
              <Label>Select Mode</Label>
              <div className="flex gap-3">
                <Button
                  variant={mode === "learn" ? "default" : "outline"}
                  className={`flex-1 h-auto py-4 transition-all ${
                    mode === "learn"
                    ? "bg-blue-600 hover:bg-blue-700 shadow-md ring-2 ring-blue-200"
                    : "border-blue-200 hover:bg-blue-50 text-slate-600"
                  }`}
                  onClick={() => setMode("learn")}
                >
                  <div className="flex flex-col items-center gap-2">
                    <BookOpen className="size-6" />
                    <span className="font-semibold">Learn Mode</span>
                    <span className="text-xs opacity-80 font-normal">Study with AI explanations</span>
                  </div>
                </Button>
                <Button
                  variant={mode === "quiz" ? "default" : "outline"}
                  className={`flex-1 h-auto py-4 transition-all ${
                    mode === "quiz"
                    ? "bg-cyan-600 hover:bg-cyan-700 shadow-md ring-2 ring-cyan-200"
                    : "border-blue-200 hover:bg-blue-50 text-slate-600"
                  }`}
                  onClick={() => setMode("quiz")}
                >
                  <div className="flex flex-col items-center gap-2">
                    <Play className="size-6" />
                    <span className="font-semibold">Quiz Mode</span>
                    <span className="text-xs opacity-80 font-normal">Test your knowledge</span>
                  </div>
                </Button>
              </div>
              {/* Online / Offline Toggle */}
              <div className="space-y-3">
                  <Label>AI Model</Label>
                  <Button
                    variant="outline"
                    className={`w-full justify-between group transition-all duration-300 ${
                      useOffline
                        ? "border-slate-300 bg-slate-50 text-slate-700"
                        : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                    }`}
                    onClick={toggleOfflineMode} // ✅ UPDATED: Uses the feedback handler
                  >
                    <span className="flex items-center gap-2">
                        {useOffline ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
                        {useOffline ? "Offline Mode (Llama 3.2)" : "Online Mode (DeepSeek)"}
                    </span>
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                        {useOffline ? "Local" : "Cloud"}
                    </span>
                  </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Difficulty Selection */}
              <div className="space-y-2">
                <Label htmlFor="difficulty">Difficulty Level</Label>
                <Select value={difficulty} onValueChange={(v: any) => setDifficulty(v)}>
                  <SelectTrigger id="difficulty" className="border-blue-200 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mixed">🔀 Mixed</SelectItem>
                    <SelectItem value="easy">🟢 Easy</SelectItem>
                    <SelectItem value="medium">🟡 Medium</SelectItem>
                    <SelectItem value="hard">🔴 Hard</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Number of Questions */}
              <div className="space-y-2">
                <Label htmlFor="questions">Number of Questions</Label>
                <Select value={numQuestions} onValueChange={setNumQuestions}>
                  <SelectTrigger id="questions" className="border-blue-200 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 Questions</SelectItem>
                    <SelectItem value="10">10 Questions</SelectItem>
                    <SelectItem value="15">15 Questions</SelectItem>
                    <SelectItem value="20">20 Questions</SelectItem>
                    <SelectItem value="custom">Custom Amount...</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Custom Questions Input */}
            {numQuestions === "custom" && (
              <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                <Label htmlFor="customQuestions">Enter Custom Amount</Label>
                <Input
                  id="customQuestions"
                  type="number"
                  placeholder="Enter number (1-50)"
                  value={customQuestions}
                  onChange={(e) => setCustomQuestions(e.target.value)}
                  className="border-blue-200 bg-white"
                  min="1"
                  max="50"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upload Document Section */}
        <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".pdf,.txt,.doc,.docx,.ppt,.pptx"
            onChange={handleFileChange}
        />
        <Card
          className={`mb-10 border-2 transition-all cursor-pointer ${
            isDragging
              ? "border-blue-500 bg-blue-50/50 shadow-xl scale-[1.01]"
              : "border-dashed border-blue-300 bg-white/60 hover:bg-white/90 hover:border-blue-400"
          } ${loading ? "opacity-75 pointer-events-none" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center text-center space-y-4">
              <div className={`p-6 rounded-full transition-colors ${loading ? "bg-slate-100" : "bg-gradient-to-br from-blue-100 to-cyan-100"}`}>
                {loading ? (
                    <Loader2 className="size-12 text-slate-400 animate-spin" />
                ) : (
                    <FileText className="size-12 text-blue-600" />
                )}
              </div>
              <div>
                <h3 className="text-xl font-semibold text-slate-800">
                    {loading ? "Analyzing Document..." : "Upload Your Documents"}
                </h3>
                <p className="text-muted-foreground mt-1 mb-4 max-w-sm mx-auto">
                  {loading
                    ? "Please wait while we generate your quiz."
                    : "Drag & drop PDF, DOCX, or TXT files here to instantly generate a new quiz."}
                </p>
                {!loading && (
                    <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                    Supported: PDF, DOCX, TXT
                    </p>
                )}
              </div>
              {!loading && (
                  <Button size="lg" className="gap-2 bg-blue-600 hover:bg-blue-700 shadow-sm">
                    <Upload className="size-5" />
                    Browse Files
                  </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quiz Library Grid */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-slate-800">Your Quiz Library</h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-white px-3 py-1 rounded-full border border-blue-100">
                <FileText className="size-4" />
                {quizzes.length} available
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {quizzes.length === 0 ? (
                <div className="col-span-full text-center py-16 bg-white/50 border border-dashed border-slate-300 rounded-xl text-slate-500">
                    <p>No quizzes yet. Upload a document above to get started!</p>
                </div>
            ) : (
                quizzes.map((quiz) => (
                <Card
                    key={quiz.id}
                    className="hover:shadow-xl transition-all border-blue-100 bg-white/90 backdrop-blur-sm group overflow-hidden"
                >
                    <CardHeader className="pb-3">
                    <CardTitle className="flex items-start justify-between gap-4">
                        <div
                            className="flex items-center gap-3 cursor-pointer"
                            onClick={() => handleQuizSelect(quiz.id)}
                        >
                            <div className="bg-gradient-to-br from-blue-500 to-cyan-600 p-2.5 rounded-lg shadow-sm">
                                <BookOpen className="size-5 text-white" />
                            </div>
                            <span className="line-clamp-2 text-lg leading-tight">{quiz.title}</span>
                        </div>

                        <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 -mr-2 text-slate-400 hover:text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                            >
                            <MoreVertical className="size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleQuizSelect(quiz.id)}>
                                <Play className="size-4 mr-2" /> Start
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDelete(quiz.id)} className="text-red-600 focus:text-red-600 focus:bg-red-50">
                                <Trash2 className="size-4 mr-2" /> Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                        </DropdownMenu>
                    </CardTitle>
                    </CardHeader>

                    <CardContent onClick={() => handleQuizSelect(quiz.id)} className="cursor-pointer">
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                        <div className="flex items-center gap-1.5">
                            <Calendar className="size-4 text-slate-400" />
                            <span>{new Date(quiz.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between mt-2 pt-4 border-t border-slate-100">
                        <span className="text-xs font-medium text-blue-600 uppercase tracking-wider">
                            {mode === "learn" ? "Practice" : "Quiz"} Ready
                        </span>
                        <Button
                        size="sm"
                        className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 shadow-sm"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleQuizSelect(quiz.id);
                        }}
                        >
                        Start <Play className="size-3 ml-2 fill-current" />
                        </Button>
                    </div>
                    </CardContent>
                </Card>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}