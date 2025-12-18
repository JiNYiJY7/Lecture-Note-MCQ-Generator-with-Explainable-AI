import { useRef, useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Upload, BookOpen, Loader2, Calendar, Trash2 } from "lucide-react";
import { api } from "../api";
import { Mode } from "../App"; // Ensure this type is exported from App.tsx

interface HomepageProps {
  onStartQuiz: (mode: Mode, questions: any[]) => void;
}

export function Homepage({ onStartQuiz }: HomepageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [quizzes, setQuizzes] = useState<any[]>([]);

  // New State for Quiz Settings
  const [mode, setMode] = useState<Mode>("learn");
  const [numQuestions, setNumQuestions] = useState<number>(10);
  const commonQuestionCounts = [5, 10, 15, 20, 30, 50];

  // Fetch existing quizzes on load
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

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      console.log("Uploading...");
      const doc = await api.uploadDocument(file);

      console.log("Generating...");
      // Pass the user-selected number of questions to the backend
      const mcqData = await api.generateMCQs(doc.id, numQuestions);

      const questionsWithIds = mcqData.questions.map((q: any, i: number) => ({
        ...q,
        id: mcqData.question_ids[i]
      }));

      // Reload quiz list
      loadQuizzes();

      // Start the quiz with the selected mode
      onStartQuiz(mode, questionsWithIds);

    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQuizSelect = async (lectureId: number) => {
    setLoading(true);
    try {
        const questions = await api.getQuizQuestions(lectureId);
        if (questions.length === 0) {
            alert("No questions found for this lecture.");
        } else {
            // Slice questions if existing quiz has more than user wants (optional feature)
            const safeCount = numQuestions > 0 ? numQuestions : questions.length;
            const limitedQuestions = questions.slice(0, safeCount);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl mb-4 font-bold text-slate-900">MCQ Quiz Platform</h1>
          <p className="text-slate-600 mb-6">Upload lecture notes or choose a saved quiz.</p>

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

          {/* Question Count Selection */}
          <div className="flex flex-col md:flex-row items-center justify-center gap-3 mb-6 text-sm">
            <span className="text-slate-600 font-medium">
              Number of questions ({mode === "learn" ? "Practice" : "Quiz"}):
            </span>
            <input
              type="number"
              min={1}
              className="border border-slate-300 rounded-md px-3 py-2 w-24 bg-white focus:ring-2 focus:ring-primary focus:outline-none"
              value={numQuestions}
              onChange={(e) => setNumQuestions(Number(e.target.value))}
            />
            <select
              className="border border-slate-300 rounded-md px-3 py-2 bg-white focus:ring-2 focus:ring-primary focus:outline-none"
              value={commonQuestionCounts.includes(numQuestions) ? numQuestions : ""}
              onChange={(e) => e.target.value && setNumQuestions(Number(e.target.value))}
            >
              <option value="">Custom...</option>
              {commonQuestionCounts.map((n) => (
                <option key={n} value={n}>
                  {n} questions
                </option>
              ))}
            </select>
          </div>

          {/* Upload Section */}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".pdf,.txt"
            onChange={handleFileChange}
          />

          <Button size="lg" className="gap-2" onClick={handleUploadClick} disabled={loading}>
            {loading ? <Loader2 className="animate-spin size-5" /> : <Upload className="size-5" />}
            {loading ? "Processing..." : "Upload New Document"}
          </Button>
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