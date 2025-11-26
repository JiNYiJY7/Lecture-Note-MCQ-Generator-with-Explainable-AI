import { useRef, useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Upload, BookOpen, MoreVertical, Settings, Trash2, Loader2 } from "lucide-react";
import { api } from "../api";

interface HomepageProps {
  onStartQuiz: (questions: any[]) => void; // Updated to receive questions
}

export function Homepage({ onStartQuiz }: HomepageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  // Trigger file input when "Upload Document" is clicked
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // Handle the file upload and generation
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      // 1. Upload
      console.log("Uploading...");
      const doc = await api.uploadDocument(file);

      // 2. Generate
      console.log("Generating...");
      const mcqData = await api.generateMCQs(doc.id);

      // 3. Format and start
      const questionsWithIds = mcqData.questions.map((q: any, i: number) => ({
        ...q,
        id: mcqData.question_ids[i]
      }));

      onStartQuiz(questionsWithIds);
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl mb-4 font-bold">MCQ Quiz Platform</h1>
          <p className="text-muted-foreground mb-6">Upload your lecture notes to auto-generate a quiz!</p>

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".pdf,.txt"
            onChange={handleFileChange}
          />

          <Button size="lg" className="gap-2" onClick={handleUploadClick} disabled={loading}>
            {loading ? <Loader2 className="animate-spin size-5" /> : <Upload className="size-5" />}
            {loading ? "AI is processing..." : "Upload Document"}
          </Button>
        </div>

        {/* Placeholder for existing quizzes (optional) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 opacity-50 pointer-events-none">
          <Card>
            <CardHeader><CardTitle>Sample Quiz</CardTitle></CardHeader>
            <CardContent><p>Upload a file above to generate real quizzes.</p></CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}