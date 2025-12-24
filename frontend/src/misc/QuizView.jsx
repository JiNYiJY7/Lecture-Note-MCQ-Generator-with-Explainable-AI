import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { CheckCircle2, XCircle, Home, Download } from "lucide-react";
import type { QuestionResult } from "../App";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface ResultsPageProps {
  score: number;
  totalQuestions: number;
  onReturnHome: () => void;
  details?: QuestionResult[];
}

type PdfVariant = "q_only" | "q_ans" | "q_ans_exp";

/**
 * ✅ Strict normalize label so:
 * - "A" == "A." == "A:" == "(A)" == "Option A" == "Answer: B"
 * - Will NOT accidentally match letters inside words (e.g., "and", "are", "could")
 */
function normalizeChoiceLabel(x: any): string {
  const s = String(x ?? "").trim();
  if (!s) return "";

  // 1) Pure label forms: A / A. / A: / (A) / A)
  let m = s.match(/^\s*[\(\[]?\s*([A-D])\s*[\)\]]?\s*[.:)]?\s*$/i);
  if (m) return m[1].toUpperCase();

  // 2) Common prefixed forms: "option B", "choice C", "answer: D"
  m = s.match(/\b(?:option|choice|answer)\s*[:\-]?\s*([A-D])\b/i);
  if (m) return m[1].toUpperCase();

  // 3) Fallback: find a standalone token A-D anywhere (word boundary)
  m = s.match(/\b([A-D])\b/i);
  if (m) return m[1].toUpperCase();

  return "";
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

  const buildQuestionBlock = (q: QuestionResult, index: number) => {
    const stem = `Q${index + 1}. ${q.stem ?? ""}`.trim();
    const opts = (q.options ?? [])
      .map((o) => `${o.label}. ${o.text ?? ""}`.trim())
      .join("\n");
    return `${stem}\n${opts}`.trim();
  };

  const generatePdf = (variant: PdfVariant) => {
    if (!details || details.length === 0) return;

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();

    // Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Quiz Export", 40, 45);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const metaLine = `Generated: ${new Date().toLocaleString()} `;
    doc.text(metaLine, 40, 63);

    const head =
      variant === "q_only"
        ? [["Questions"]]
        : variant === "q_ans"
        ? [["Questions", "Answer"]]
        : [["Questions", "Answer", "Explanation"]];

    const body = details.map((q, idx) => {
      const questionBlock = buildQuestionBlock(q, idx);

      const answerText =
        q.correctLabel && String(q.correctLabel).trim().length > 0
          ? `Correct: ${q.correctLabel}`
          : "Correct: -";

      const explanationText =
        q.explanation && String(q.explanation).trim().length > 0
          ? q.explanation
          : "No explanation available.";

      if (variant === "q_only") return [questionBlock];
      if (variant === "q_ans") return [questionBlock, answerText];
      return [questionBlock, answerText, explanationText];
    });

    autoTable(doc, {
      head,
      body,
      startY: 80,
      margin: { left: 40, right: 40 },
      rowPageBreak: "avoid",
      pageBreak: "auto",
      styles: {
        font: "TimesNewRoman",
        fontSize: 10,
        cellPadding: 6,
        valign: "top",
        overflow: "linebreak",
      },
      headStyles: { fontStyle: "bold" },
      columnStyles:
        variant === "q_only"
          ? { 0: { cellWidth: pageWidth - 80 } }
          : variant === "q_ans"
          ? {
              0: { cellWidth: pageWidth * 0.68 - 40 },
              1: { cellWidth: pageWidth * 0.32 - 40 },
            }
          : {
              0: { cellWidth: pageWidth * 0.52 - 40 },
              1: { cellWidth: pageWidth * 0.18 - 40 },
              2: { cellWidth: pageWidth * 0.3 - 40 },
            },
    });

    const fileSuffix =
      variant === "q_only"
        ? "questions"
        : variant === "q_ans"
        ? "answers"
        : "answers_explanations";

    const filename = `LN_MCQ_${new Date()
      .toISOString()
      .slice(0, 10)}_${fileSuffix}.pdf`;
    doc.save(filename);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 p-8">
      <div className="max-w-4xl mx-auto space-y-8">
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

            <div className="flex flex-col md:flex-row justify-center pt-4 gap-3">
              <Button size="lg" onClick={onReturnHome} className="gap-2">
                <Home className="size-5" />
                Return to Home
              </Button>

              <Button
                size="lg"
                variant="outline"
                className="gap-2"
                disabled={!details || details.length === 0}
                onClick={() => generatePdf("q_only")}
              >
                <Download className="size-5" />
                PDF: Question Only
              </Button>

              <Button
                size="lg"
                variant="outline"
                className="gap-2"
                disabled={!details || details.length === 0}
                onClick={() => generatePdf("q_ans")}
              >
                <Download className="size-5" />
                PDF: Marking Scheme
              </Button>

              <Button
                size="lg"
                variant="outline"
                className="gap-2"
                disabled={!details || details.length === 0}
                onClick={() => generatePdf("q_ans_exp")}
              >
                <Download className="size-5" />
                PDF: Marking Scheme + Explainations
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

              // ✅ normalize once
              const selectedN = normalizeChoiceLabel(q.selectedLabel);
              const correctN_raw = normalizeChoiceLabel(q.correctLabel);

              // ✅ fallback: if correctLabel missing but question is correct, selected is the correct
              const correctN =
                correctN_raw ||
                (isCorrectQuestion && selectedN ? selectedN : "");

              const answered = !!selectedN;

              return (
                <Card
                  key={(q as any).questionId ?? index}
                  className="bg-white/90 backdrop-blur border border-slate-200"
                >
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle className="text-base font-semibold">
                      Q{index + 1}. {q.stem}
                    </CardTitle>

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
                    {/* ✅ optional debug (remove later) */}
                    <p className="text-xs text-slate-500">
                      debug: rawSelected="{String(q.selectedLabel ?? "")}" rawCorrect="
                      {String(q.correctLabel ?? "")}" → selectedN="
                      {selectedN || "-"}" correctN="{correctN || "-"}"
                    </p>

                    <div className="space-y-2">
                      {(q.options ?? []).map((opt) => {
                        const optN = normalizeChoiceLabel(opt.label);

                        const isSelected = answered && optN === selectedN;
                        const isCorrectOption = !!correctN && optN === correctN;

                        let classes = "border border-slate-200 bg-white/80";

                        if (answered) {
                          // show correct option green (if known)
                          if (isCorrectOption) {
                            classes =
                              "border-2 border-emerald-500 bg-emerald-100 shadow-sm";
                          }

                          // show selected wrong red
                          if (isSelected && correctN && selectedN !== correctN) {
                            classes =
                              "border-2 border-red-500 bg-red-50 shadow-sm";
                          }

                          // selected correct stronger green
                          if (isSelected && correctN && selectedN === correctN) {
                            classes =
                              "border-2 border-emerald-600 bg-emerald-100 shadow-sm";
                          }

                          // if correct not available at all, still highlight selected (neutral)
                          if (isSelected && !correctN) {
                            classes =
                              "border-2 border-indigo-400 bg-indigo-50 shadow-sm";
                          }
                        }

                        return (
                          <div
                            key={opt.label}
                            className={`rounded-md px-3 py-2 text-sm flex gap-2 ${classes}`}
                          >
                            {/* ✅ display normalized label so it never becomes "A.." */}
                            <span className="font-semibold min-w-6">
                              {optN}.
                            </span>
                            <span>{opt.text}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-2 text-sm">
                      {q.selectedLabel ? (
                        q.isCorrect ? (
                          <p className="mb-1 text-emerald-700">
                            You selected{" "}
                            <span className="font-semibold">
                              option {q.selectedLabel}
                            </span>
                            , which is correct.
                          </p>
                        ) : (
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
