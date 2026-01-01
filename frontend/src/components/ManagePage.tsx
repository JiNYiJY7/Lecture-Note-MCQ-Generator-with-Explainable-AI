import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Home, Save } from "lucide-react";
import { toast } from "sonner"; // Changed from "sonner@2.0.3" to "sonner"
import { api } from "../api"; // Assume you'll add a fetch method here

interface ManagePageProps {
  topicId: string; // In your app, this might actually be lectureId (number) based on previous context
  onReturnHome: () => void;
}

interface Question {
  id: number;
  question: string; // This maps to 'stem' in your backend
  options: string[]; // Your backend uses {label, text}, frontend might need adaptation
  correctAnswer: number; // Index of correct answer
}

export function ManagePage({ topicId, onReturnHome }: ManagePageProps) {
  // Initialize with empty array, fetch real data in useEffect
  const [questions, setQuestions] = useState<Question[]>([]);

  // Mock data for now if you don't have an endpoint to list questions for editing
  useEffect(() => {
      // Example: Fetch questions for this lecture/topic
      // api.getQuestions(topicId).then(setQuestions);

      // For visual testing only:
      setQuestions([
          { id: 1, question: "Sample Question?", options: ["A", "B", "C", "D"], correctAnswer: 0 }
      ]);
  }, [topicId]);

  const handleQuestionChange = (id: number, value: string) => {
    setQuestions(questions.map((q) => q.id === id ? { ...q, question: value } : q));
  };

  const handleOptionChange = (id: number, optionIndex: number, value: string) => {
    setQuestions(questions.map((q) => q.id === id ? { ...q, options: q.options.map((opt, idx) => idx === optionIndex ? value : opt) } : q));
  };

  const handleCorrectAnswerChange = (id: number, value: number) => {
    setQuestions(questions.map((q) => q.id === id ? { ...q, correctAnswer: value } : q));
  };

  const handleSaveQuestion = (id: number) => {
    const q = questions.find((q) => q.id === id);
    console.log("Saving:", q);
    // api.updateQuestion(q); // TODO: Implement this API method
    toast.success("Question saved successfully!");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 to-blue-100 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl mb-2">Manage Quiz Questions</h1>
          <p className="text-muted-foreground">Edit and save your quiz questions</p>
        </div>

        <div className="space-y-6 mb-8">
          {questions.map((question) => (
            <Card key={question.id} className="bg-white/80 backdrop-blur">
              <CardHeader>
                <CardTitle>Question {question.id}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={`question-${question.id}`}>Question</Label>
                  <Input
                    id={`question-${question.id}`}
                    value={question.question}
                    onChange={(e) => handleQuestionChange(question.id, e.target.value)}
                  />
                </div>

                <div className="space-y-3">
                  <Label>Answer Options</Label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {question.options.map((option, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`correct-${question.id}`}
                          checked={question.correctAnswer === index}
                          onChange={() => handleCorrectAnswerChange(question.id, index)}
                          className="w-4 h-4" // Standard tailwind
                        />
                        <Input
                          value={option}
                          onChange={(e) => handleOptionChange(question.id, index, e.target.value)}
                          placeholder={`Option ${String.fromCharCode(65 + index)}`}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground">Select the radio button for the correct answer</p>
                </div>

                <div className="flex justify-end pt-2">
                  <Button onClick={() => handleSaveQuestion(question.id)} className="gap-2">
                    <Save className="w-4 h-4" />
                    Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex justify-center pb-8">
          <Button size="lg" variant="outline" onClick={onReturnHome} className="gap-2">
            <Home className="w-5 h-5" />
            Return to Home
          </Button>
        </div>
      </div>
    </div>
  );
}