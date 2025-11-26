import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { CheckCircle2, XCircle, Home } from "lucide-react";

interface ResultsPageProps {
  score: number;
  totalQuestions: number;
  onReturnHome: () => void;
}

export function ResultsPage({ score, totalQuestions, onReturnHome }: ResultsPageProps) {
  const percentage = Math.round((score / totalQuestions) * 100);

  const getPerformanceMessage = () => {
    if (percentage >= 80) return "Excellent work! 🎉";
    if (percentage >= 60) return "Good job! 👍";
    if (percentage >= 40) return "Not bad, keep practicing! 💪";
    return "Keep learning and try again! 📚";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 p-8">
      <div className="max-w-4xl mx-auto">
        <Card className="bg-white/80 backdrop-blur">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl">Quiz Complete!</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center size-32 rounded-full bg-primary/10">
                {percentage >= 60 ? (
                  <CheckCircle2 className="size-16 text-green-600" />
                ) : (
                  <XCircle className="size-16 text-orange-600" />
                )}
              </div>
              <h2 className="text-5xl">{percentage}%</h2>
              <p className="text-xl text-muted-foreground">{getPerformanceMessage()}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-6 text-center">
                  <p className="text-muted-foreground mb-2">Total Questions</p>
                  <p className="text-3xl">{totalQuestions}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 text-center">
                  <p className="text-muted-foreground mb-2">Correct Answers</p>
                  <p className="text-3xl text-green-600">{score}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6 text-center">
                  <p className="text-muted-foreground mb-2">Incorrect Answers</p>
                  <p className="text-3xl text-red-600">{totalQuestions - score}</p>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-center pt-4">
              <Button size="lg" onClick={onReturnHome} className="gap-2">
                <Home className="size-5" />
                Return to Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
