import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { CheckCircle2, XCircle, Home } from "lucide-react";
import type { QuestionResult } from "../App";

interface ResultsPageProps {
  score: number;
  totalQuestions: number;
  onReturnHome: () => void;
  details?: QuestionResult[];
}

export function ResultsPage({
  score,
  totalQuestions,
  onReturnHome,
  details = [],
}: ResultsPageProps) {
  const percentage =
    totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
  const incorrect = totalQuestions - score;

  const getPerformanceMessage = () => {
    if (percentage >= 80) return "Excellent work! 🎉";
    if (percentage >= 60) return "Good job! 👍";
    if (percentage >= 40) return "Not bad, keep practicing! 💪";
    return "Keep learning and try again! 📚";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* === Top summary card (original UI) === */}
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
              <p className="text-xl text-muted-foreground">
                {getPerformanceMessage()}
              </p>
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
                  <p className="text-muted-foreground mb-2">
                    Incorrect Answers
                  </p>
                  <p className="text-3xl text-red-600">{incorrect}</p>
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

        {/* === Question-by-question explanations === */}
        {details.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">
              Question-by-question explanations
            </h2>

            {details.map((q, index) => {
              const isCorrectQuestion = q.isCorrect;

              return (
                <Card
                  key={q.questionId ?? index}
                  className="bg-white/90 backdrop-blur border border-slate-200"
                >
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle className="text-base font-semibold">
                      Q{index + 1}. {q.stem}
                    </CardTitle>

                    {/* Status pill: Correct / Incorrect */}
                    {q.selectedLabel && (
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          isCorrectQuestion
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {isCorrectQuestion ? "Correct" : "Incorrect"}
                      </span>
                    )}
                  </CardHeader>

                  <CardContent className="space-y-3">
                    {/* Options with red/green highlight logic */}
                    <div className="space-y-2">
                      {q.options.map((opt) => {
                        const isSelected = opt.label === q.selectedLabel;
                        const isCorrectOption =
                          q.correctLabel && opt.label === q.correctLabel;

                        // Base neutral style
                        let classes = "border border-slate-200 bg-white/80";

                        if (q.selectedLabel) {
                          if (q.isCorrect) {
                            // Question answered correctly:
                            // ONLY the selected (correct) option is green
                            if (isSelected) {
                              classes =
                                "border-2 border-emerald-600 bg-emerald-100 shadow-sm";
                            }
                          } else {
                            // Question answered incorrectly:
                            // ONLY the selected wrong option is red,
                            // and ONLY the correct option is green
                            if (isSelected) {
                              classes =
                                "border-2 border-red-500 bg-red-50 shadow-sm";
                            } else if (isCorrectOption) {
                              classes =
                                "border-2 border-emerald-600 bg-emerald-100 shadow-sm";
                            }
                          }
                        }

                        return (
                          <div
                            key={opt.label}
                            className={`rounded-md px-3 py-2 text-sm flex gap-2 ${classes}`}
                          >
                            <span className="font-semibold min-w-6">
                              {opt.label}.
                            </span>
                            <span>{opt.text}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Text summary + explanation */}
                    <div className="mt-2 text-sm">
                      {q.selectedLabel ? (
                        q.isCorrect ? (
                          // Correct: do not repeat "correct answer is ..."
                          <p className="mb-1 text-emerald-700">
                            You selected{" "}
                            <span className="font-semibold">
                              option {q.selectedLabel}
                            </span>
                            , which is correct.
                          </p>
                        ) : (
                          // Incorrect: show both selected and correct
                          <p className="mb-1 text-red-700">
                            You selected{" "}
                            <span className="font-semibold">
                              option {q.selectedLabel}
                            </span>
                            {q.correctLabel && (
                              <>
                                , correct answer is{" "}
                                <span className="font-semibold">
                                  option {q.correctLabel}
                                </span>
                                .
                              </>
                            )}
                          </p>
                        )
                      ) : (
                        <p className="mb-1 text-muted-foreground">
                          You did not answer this question.
                        </p>
                      )}

                      <p className="text-sm text-slate-700 whitespace-pre-line">
                        {q.explanation && q.explanation.trim().length > 0
                          ? q.explanation
                          : "No explanation available for this question."}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}