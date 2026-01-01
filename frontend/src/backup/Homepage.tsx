import { useRef, useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Upload, BookOpen, Loader2, Calendar, Trash2 } from "lucide-react";
import { api } from "../api";
import { Mode } from "../App";

interface HomepageProps {
  onStartQuiz: (mode: Mode, questions: any[]) => void;
}

type DifficultyChoice = "mixed" | "easy" | "medium" | "hard";

export function Homepage({ onStartQuiz }: HomepageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [quizzes, setQuizzes] = useState<any[]>([]);

  // Mode + question count
  const [mode, setMode] = useState<Mode>("learn");

  // ✅ Difficulty (optional)
  // "mixed" means: do not constrain difficulty (current behaviour)
  const [difficulty, setDifficulty] = useState<DifficultyChoice>("mixed");

  // Select dropdown choice: numeric string OR "custom"
  const [questionChoice, setQuestionChoice] = useState<string>("10");

  // Actual numeric input (string so it can be truly empty)
  const [numQuestions, setNumQuestions] = useState<string>("10");

  const commonQuestionCounts = [5, 10, 15, 20, 30, 50];

  // Error handling (English)
  const [numError, setNumError] = useState<string | null>(null);

  // Drag & drop UI
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    loadQuizzes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadQuizzes = async () => {
    try {
      const data = await api.getLectures();
      setQuizzes(data);
    } catch (err) {
      console.error("Failed to load quizzes:", err);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const clamp = (v: number, min: number, max: number) => {
    if (Number.isNaN(v)) return min;
    return Math.max(min, Math.min(max, v));
  };

  const parseQuestionCount = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === "") return null;

    const n = Number(trimmed);
    if (!Number.isFinite(n)) return null;
    if (n <= 0) return null;

    // keep integer, clamp to a sane max
    return clamp(Math.floor(n), 1, 200);
  };

  const validateQuestionCount = (): number | null => {
    const n = parseQuestionCount(numQuestions);
    if (n === null) {
      if (numQuestions.trim() === "") {
        setNumError("Please enter the number of questions.");
      } else {
        setNumError("Number of questions must be at least 1.");
      }
      return null;
    }
    setNumError(null);
    return n;
  };

  const isCountValid = parseQuestionCount(numQuestions) !== null;

  // Reusable file processing (input upload + drag/drop share the same flow)
  const processFile = async (file: File) => {
    const count = validateQuestionCount();
    if (count === null) return;

    setLoading(true);
    try {
      const doc = await api.uploadDocument(file);

      // ✅ pass difficulty (mixed/easy/medium/hard)
      // - "mixed" => api.js will NOT send difficulty to backend
      const mcqData = await api.generateMCQs(doc.id, count, difficulty);

      const questionsWithIds = mcqData.questions.map((q: any, i: number) => ({
        ...q,
        id: mcqData.question_ids[i],
      }));

      await loadQuizzes();
      onStartQuiz(mode, questionsWithIds);
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    await processFile(file);

    // Reset value so choosing the same file again still triggers change event
    e.target.value = "";
  };

  // Drag handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!loading) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (loading) return;

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    const isOkType =
      ["application/pdf", "text/plain"].includes(file.type) ||
      file.name.toLowerCase().endsWith(".pdf") ||
      file.name.toLowerCase().endsWith(".txt") ||
      file.name.toLowerCase().endsWith(".docx") ||
      file.name.toLowerCase().endsWith(".ppt");    

    if (!isOkType) {
      alert("Please drop a PDF, TXT, DOCX or PPT.");
      return;
    }

    await processFile(file);
  };

  const handleQuizSelect = async (lectureId: number) => {
    const count = validateQuestionCount();
    if (count === null) return;

    setLoading(true);
    try {
      const questions = await api.getQuizQuestions(lectureId);

      if (questions.length === 0) {
        alert("No questions found for this lecture.");
      } else {
        const limitedQuestions = questions.slice(0, count);
        onStartQuiz(mode, limitedQuestions);
      }
    } catch (err: any) {
      alert("Failed to load quiz: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, lectureId: number) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to hide this quiz?")) return;

    try {
      await api.deleteLecture(lectureId);
      setQuizzes((prev) => prev.filter((q) => q.id !== lectureId));
    } catch (err: any) {
      alert("Failed to delete: " + err.message);
    }
  };

  // Dropdown behavior (arrow opens list like your screenshot)
  const handleQuestionChoiceChange = (value: string) => {
    setQuestionChoice(value);
    setNumError(null);

    if (value === "custom") {
      // clear cleanly
      setNumQuestions("");
    } else {
      setNumQuestions(value);
    }
  };

  const handleCustomInputChange = (value: string) => {
    // allow truly empty
    if (value.trim() === "") {
      setNumQuestions("");
      setNumError(null);
      return;
    }

    // keep digits only-ish (still allow user typing)
    const n = Number(value);
    if (!Number.isFinite(n)) {
      setNumQuestions(value);
      return;
    }

    // allow 0 to display but it will fail validation
    const clamped = clamp(Math.floor(n), 0, 200);
    setNumQuestions(String(clamped));
    setNumError(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl mb-4 font-bold text-slate-900">
            MCQ Quiz Platform
          </h1>
          <p className="text-slate-600 mb-6">
            Upload lecture notes or choose a saved quiz.
          </p>

          {/* Mode Selection */}
          <div className="flex justify-center gap-3 mb-4">
            <Button
              variant={mode === "learn" ? "default" : "outline"}
              onClick={() => setMode("learn")}
              className="w-32"
            >
              Learn Mode
            </Button>
            <Button
              variant={mode === "quiz" ? "default" : "outline"}
              onClick={() => setMode("quiz")}
              className="w-32"
            >
              Quiz Mode
            </Button>
          </div>

          {/* ✅ Difficulty Selection (Optional) */}
          <div className="flex flex-col items-center justify-center gap-2 mb-4 text-sm">
            <span className="text-slate-600 font-medium">Difficulty:</span>
            <select
              className={[
                "border border-slate-300 rounded-md px-3 py-2 bg-white",
                "focus:ring-2 focus:ring-primary focus:outline-none",
                "w-48 text-center",
              ].join(" ")}
              value={difficulty}
              onChange={(e) =>
                setDifficulty(e.target.value as DifficultyChoice)
              }
              disabled={loading}
            >
              <option value="mixed">Any (Mixed)</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>

            <div className="text-[8px] text-slate-500">
              * “Any (Mixed)” to generate a mix of question difficulties.
            </div>
          </div>

          {/* Question Count Selection (ONE control at a time: dropdown -> custom input) */}
          <div className="flex flex-col items-center justify-center gap-2 mb-6 text-sm">
            <span className="text-slate-600 font-medium">
              Number of questions ({mode === "learn" ? "Practice" : "Quiz"}):
            </span>

            {questionChoice !== "custom" ? (
              <select
                className={[
                  "border border-slate-300 rounded-md px-3 py-2 bg-white",
                  "focus:ring-2 focus:ring-primary focus:outline-none",
                  "w-48 text-center",
                  numError ? "border-red-400 focus:ring-red-200" : "",
                ].join(" ")}
                value={questionChoice}
                onChange={(e) => handleQuestionChoiceChange(e.target.value)}
              >
                <option value="custom">Custom...</option>
                {commonQuestionCounts.map((n) => (
                  <option key={n} value={String(n)}>
                    {n} questions
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={1}
                  placeholder="Enter a number"
                  className={[
                    "border rounded-md px-3 py-2 w-48 bg-white text-center",
                    "focus:ring-2 focus:ring-primary focus:outline-none",
                    numError
                      ? "border-red-400 focus:ring-red-200"
                      : "border-slate-300",
                  ].join(" ")}
                  value={numQuestions}
                  onChange={(e) => handleCustomInputChange(e.target.value)}
                />

                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 px-2 text-xs text-slate-600"
                  onClick={() => handleQuestionChoiceChange("10")}
                >
                  Back to presets
                </Button>
              </div>
            )}

            {numError && <div className="text-xs text-red-600">{numError}</div>}

            {!isCountValid && (
              <div className="text-[11px] text-red-600">
                Please set a valid number of questions (at least 1).
              </div>
            )}
          </div>

          {/* Upload Section (hidden input to avoid "Choose file..." line) */}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".pdf,.txt,.doc,.docx,.ppt,.pptx,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            onChange={handleFileChange}
          />

          {/* Neat Dropzone */}
          <div className="mt-6 flex justify-center">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={[
                "w-full max-w-md",
                "rounded-2xl border border-slate-200 bg-white/70 backdrop-blur",
                "shadow-sm px-6 py-6 transition",
                isDragging ? "border-indigo-500 ring-2 ring-indigo-200" : "",
                loading ? "opacity-70 pointer-events-none" : "",
              ].join(" ")}
            >
              <div className="text-center space-y-3">
                <div className="text-sm font-semibold text-slate-800">
                  Drag & drop your PDF/TXT/DOCX/PPT here
                </div>
                <div className="text-xs text-slate-500">
                  or click the button to browse
                </div>

                <Button
                  size="lg"
                  className="gap-2 w-full"
                  onClick={handleUploadClick}
                  disabled={loading || !isCountValid}
                >
                  {loading ? (
                    <Loader2 className="animate-spin size-5" />
                  ) : (
                    <Upload className="size-5" />
                  )}
                  {loading ? "Processing..." : "Upload New Document"}
                </Button>

                <div className="text-[11px] text-slate-400">
                  Supported: .pdf, .txt,.docx, ppt 
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Existing Quizzes Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {quizzes.length === 0 ? (
            <div className="col-span-full text-center text-slate-500 py-10 bg-white/50 rounded-xl border border-dashed border-slate-300">
              No quizzes found. Upload a document to get started!
            </div>
          ) : (
            quizzes.map((quiz) => (
              <Card
                key={quiz.id}
                className="hover:shadow-lg transition-shadow cursor-pointer border-slate-200 group relative"
                onClick={() => handleQuizSelect(quiz.id)}
              >
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                    onClick={(e) => handleDelete(e, quiz.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-lg font-medium line-clamp-1 pr-8">
                    {quiz.title}
                  </CardTitle>
                  <BookOpen className="h-4 w-4 text-slate-500" />
                </CardHeader>

                <CardContent>
                  <div className="flex items-center text-sm text-slate-500 mt-2">
                    <Calendar className="mr-2 h-4 w-4" />
                    {new Date(quiz.created_at).toLocaleDateString()}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
