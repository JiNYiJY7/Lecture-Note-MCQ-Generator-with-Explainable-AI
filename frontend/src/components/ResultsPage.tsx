import { useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { CheckCircle2, XCircle, Home, Download, Send } from "lucide-react";
import type { QuestionResult } from "../App";
import { api } from "../api";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface ResultsPageProps {
  score: number;
  totalQuestions: number;
  onReturnHome: () => void;
  details?: QuestionResult[];
}

type PdfVariant = "q_only" | "q_ans" | "q_ans_exp";

/** Extract A-D from selected/correct text safely */
function getChoiceLetter(x: any): string {
  const s = String(x ?? "").trim();
  if (!s) return "";

  // pure: "A" / "A." / "(A)" / "A:"
  let m = s.match(/^\s*[\(\[]?\s*([A-D])\s*[\)\]]?\s*[.:)]?\s*$/i);
  if (m) return m[1].toUpperCase();

  // "option B" / "answer: C" / "choice D"
  m = s.match(/\b(?:option|choice|answer)\s*[:\-]?\s*([A-D])\b/i);
  if (m) return m[1].toUpperCase();

  // fallback standalone token
  m = s.match(/\b([A-D])\b/i);
  if (m) return m[1].toUpperCase();

  return "";
}

/** Option label is usually "A." / "B" / "C:" -> take only the leading letter */
function getOptionLetter(x: any): string {
  const s = String(x ?? "").trim();
  const m = s.match(/^\s*([A-D])/i);
  return m ? m[1].toUpperCase() : "";
}

type FollowMsg = { id: number; sender: "user" | "ai"; text: string };
type FollowState = {
  input: string;
  loading: boolean;
  messages: FollowMsg[];
  error?: string | null;
};

const DEFAULT_FOLLOW: FollowState = {
  input: "",
  loading: false,
  messages: [],
  error: null,
};

export function ResultsPage({
  score,
  totalQuestions,
  onReturnHome,
  details = [],
}: ResultsPageProps) {
  const percentage =
    totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
  const incorrect = totalQuestions - score;

  // ✅ Per-question follow-up chat state (ResultsPage only)
  const [followups, setFollowups] = useState<Record<number, FollowState>>({});

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

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Quiz Export", 40, 45);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()} `, 40, 63);

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

  // ✅ IMPORTANT: when updating followups, ONLY use `prev` (never read outer followups)
  const getFU = (prev: Record<number, FollowState>, qid: number): FollowState => {
    return prev[qid] ?? DEFAULT_FOLLOW;
  };

  const setFollowInput = (qid: number, value: string) => {
    setFollowups((prev) => {
      const st = getFU(prev, qid);
      return {
        ...prev,
        [qid]: {
          ...st,
          input: value,
          error: null,
        },
      };
    });
  };

  const askFollowUp = async (q: QuestionResult) => {
    const qid = q.questionId;

    // Read current input (ok to read outer once here)
    const current = followups[qid] ?? DEFAULT_FOLLOW;
    const text = (current.input ?? "").trim();
    if (!text) return;

    const userMsg: FollowMsg = { id: Date.now(), sender: "user", text };

    // push user msg + set loading + CLEAR input (using prev)
    setFollowups((prev) => {
      const st = getFU(prev, qid);
      return {
        ...prev,
        [qid]: {
          ...st,
          input: "", // ✅ clear immediately so it won't reappear
          loading: true,
          error: null,
          messages: [...(st.messages ?? []), userMsg],
        },
      };
    });

    // Build a context-rich prompt so quiz follow-ups are as useful as learn-mode
    const optionsBlock = JSON.stringify(q.options ?? []);
    const selected = q.selectedLabel ?? "";
    const correct = q.correctLabel ?? "";
    const baseExplanation = q.explanation ?? "";

    const prompt = `
You are my AI tutor. Answer my follow-up question based on this MCQ context.

My follow-up question: "${text}"

MCQ Context:
- Question ID: ${qid}
- Stem: "${q.stem}"
- Options: ${optionsBlock}
- My selected option: "${selected}"
- Correct option (if known): "${correct}"
- Current explanation shown: "${baseExplanation}"

Please:
- Answer clearly in 3–6 short sentences.
- If I am confused about a concept, explain the concept briefly.
- If possible, point out which option text supports the answer.
`.trim();

    try {
      const resp = await api.sendChatMessage(qid, prompt);
      const aiText = String(resp?.response ?? "").trim();
      const aiMsg: FollowMsg = {
        id: Date.now() + 1,
        sender: "ai",
        text: aiText || "No response.",
      };

      setFollowups((prev) => {
        const st = getFU(prev, qid);
        return {
          ...prev,
          [qid]: {
            ...st,
            loading: false,
            error: null,
            messages: [...(st.messages ?? []), aiMsg],
            // input stays as "" (do not restore)
          },
        };
      });
    } catch (err: any) {
      setFollowups((prev) => {
        const st = getFU(prev, qid);
        return {
          ...prev,
          [qid]: {
            ...st,
            loading: false,
            error: "Failed to ask the tutor. Please try again.",
          },
        };
      });
      console.error("askFollowUp failed", err);
    }
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
                  <p className="text-muted-foreground mb-2">Incorrect Answers</p>
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

        {/* Question-by-question */}
        {details.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">
              Question-by-question explanations
            </h2>

            {details.map((q, index) => {
              const selected = getChoiceLetter(q.selectedLabel);
              const correct =
                getChoiceLetter(q.correctLabel) || (q.isCorrect ? selected : "");

              const answered = !!selected;
              const hasCorrect = !!correct;

              const qid = q.questionId;
              const fu = followups[qid] ?? DEFAULT_FOLLOW;

              return (
                <Card
                  key={qid}
                  className="bg-white/90 backdrop-blur border border-slate-200"
                >
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle className="text-base font-semibold">
                      Q{index + 1}. {q.stem}
                    </CardTitle>

                    {q.selectedLabel && (
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          q.isCorrect
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {q.isCorrect ? "Correct" : "Incorrect"}
                      </span>
                    )}
                  </CardHeader>

                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      {(q.options ?? []).map((opt) => {
                        const optLetter = getOptionLetter(opt.label);

                        const isSelected =
                          answered && optLetter && optLetter === selected;
                        const isCorrectOption =
                          hasCorrect && optLetter && optLetter === correct;

                        // ✅ FORCE inline colors
                        let backgroundColor = "rgba(255,255,255,0.85)";
                        let borderColor = "#e2e8f0";
                        let borderWidth = 1;

                        if (answered && isCorrectOption) {
                          backgroundColor = "#d1fae5"; // light green
                          borderColor = "#10b981";
                          borderWidth = 2;
                        }

                        if (
                          answered &&
                          isSelected &&
                          hasCorrect &&
                          selected !== correct
                        ) {
                          backgroundColor = "#fee2e2"; // light red
                          borderColor = "#ef4444";
                          borderWidth = 2;
                        }

                        return (
                          <div
                            key={opt.label}
                            style={{
                              backgroundColor,
                              borderColor,
                              borderWidth,
                              borderStyle: "solid",
                              borderRadius: 10,
                              padding: "10px 12px",
                              display: "flex",
                              gap: 8,
                            }}
                          >
                            <span style={{ fontWeight: 700, minWidth: 24 }}>
                              {optLetter || String(opt.label).trim()}.
                            </span>

                            <span style={{ flex: 1 }}>{opt.text}</span>

                            {answered && isCorrectOption && (
                              <span
                                style={{ fontWeight: 700, color: "#047857" }}
                              >
                                ✓
                              </span>
                            )}
                            {answered &&
                              isSelected &&
                              hasCorrect &&
                              selected !== correct && (
                                <span
                                  style={{ fontWeight: 700, color: "#b91c1c" }}
                                >
                                  ✗
                                </span>
                              )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-2 text-sm">
                      {q.selectedLabel ? (
                        q.isCorrect ? (
                          <p className="mb-1" style={{ color: "#047857" }}>
                            You selected{" "}
                            <span style={{ fontWeight: 700 }}>
                              option {q.selectedLabel}
                            </span>
                            , which is correct.
                          </p>
                        ) : (
                          <p className="mb-1" style={{ color: "#b91c1c" }}>
                            You selected{" "}
                            <span style={{ fontWeight: 700 }}>
                              option {q.selectedLabel}
                            </span>
                            {q.correctLabel && (
                              <>
                                , correct answer is{" "}
                                <span style={{ fontWeight: 700 }}>
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

                    {/* ✅ NEW: per-question follow-up box (works for Quiz too) */}
                    <div className="pt-3 border-t border-slate-200/60">
                      <div className="text-xs font-semibold text-slate-700 mb-2">
                        Ask a follow-up question (this question only)
                      </div>

                      {/* history */}
                      {fu.messages.length > 0 && (
                        <div className="mb-3 space-y-2">
                          {fu.messages.map((m) => (
                            <div
                              key={m.id}
                              className={[
                                "text-sm whitespace-pre-line",
                                m.sender === "user"
                                  ? "text-slate-900"
                                  : "text-slate-700",
                              ].join(" ")}
                            >
                              <span className="font-semibold">
                                {m.sender === "user" ? "You: " : "Tutor: "}
                              </span>
                              {m.text}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <input
                          className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          placeholder="E.g., Why is option D correct?"
                          value={fu.input}
                          onChange={(e) => setFollowInput(qid, e.target.value)}
                          onKeyDown={(e) =>
                            e.key === "Enter" && !fu.loading && askFollowUp(q)
                          }
                          disabled={fu.loading}
                        />
                        <Button
                          size="icon"
                          className="rounded-full"
                          onClick={() => askFollowUp(q)}
                          disabled={!fu.input.trim() || fu.loading}
                        >
                          <Send className="w-4 h-4" />
                        </Button>
                      </div>

                      {fu.loading && (
                        <div className="text-xs text-slate-500 mt-2">
                          Tutor is thinking…
                        </div>
                      )}
                      {fu.error && (
                        <div className="text-xs text-red-600 mt-2">
                          {fu.error}
                        </div>
                      )}
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
