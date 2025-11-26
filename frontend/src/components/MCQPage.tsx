import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { ScrollArea } from "./ui/scroll-area";
import { Bot } from "lucide-react";
import { api } from "../api";

interface Question {
  id: number;
  stem: string;
  options: { label: string; text: string }[];
}

interface MCQPageProps {
  questions: Question[];
  onComplete: (score: number) => void;
}

interface ChatMessage {
  id: number;
  text: string;
  sender: "user" | "ai";
}

export function MCQPage({ questions, onComplete }: MCQPageProps) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [score, setScore] = useState(0);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: 1, text: "Hello! I'm your AI Tutor. Select an answer, and I'll explain if it's correct.", sender: "ai" },
  ]);
  const [loadingXAI, setLoadingXAI] = useState(false);

  const progress = ((currentQuestion + 1) / questions.length) * 100;
  const currentQ = questions[currentQuestion];

  const handleAnswerSelect = async (label: string) => {
    setSelectedAnswer(label);
    setLoadingXAI(true);

    // Add user selection to chat
    const userMsg: ChatMessage = {
        id: Date.now(),
        text: `I choose option ${label}: ${currentQ.options.find(o => o.label === label)?.text}`,
        sender: "user"
    };
    setChatMessages(prev => [...prev, userMsg]);

    try {
        const explanation = await api.getExplanation(currentQ.id, label);

        if (explanation.is_correct) {
            setScore(prev => prev + 1);
        }

        // Add AI response to chat
        const aiMsg: ChatMessage = {
            id: Date.now() + 1,
            text: explanation.reasoning,
            sender: "ai"
        };
        setChatMessages(prev => [...prev, aiMsg]);

    } catch (error: any) {
        setChatMessages(prev => [...prev, { id: Date.now(), text: "Error fetching explanation.", sender: "ai" }]);
    } finally {
        setLoadingXAI(false);
    }
  };

  const handleNext = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
      setSelectedAnswer(null);
      setChatMessages([{ id: Date.now(), text: "Next question! What do you think?", sender: "ai" }]);
    } else {
      onComplete(score);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">
              Question {currentQuestion + 1} of {questions.length}
            </span>
            <span className="text-sm">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-3" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Question Card */}
            <Card className="bg-white/80 backdrop-blur">
              <CardHeader>
                <CardTitle>Question {currentQuestion + 1}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg">{currentQ.stem}</p>
              </CardContent>
            </Card>

            {/* Answer Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {currentQ.options.map((option) => (
                <Card
                  key={option.label}
                  className={`cursor-pointer transition-all hover:shadow-lg ${
                    selectedAnswer === option.label
                      ? "ring-2 ring-primary bg-primary/10"
                      : "bg-white/80 backdrop-blur"
                  } ${selectedAnswer ? "pointer-events-none opacity-80" : ""}`}
                  onClick={() => handleAnswerSelect(option.label)}
                >
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          selectedAnswer === option.label ? "bg-primary text-primary-foreground" : "bg-muted"
                        }`}
                      >
                        {option.label}
                      </div>
                      <p>{option.text}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex justify-end">
              <Button size="lg" onClick={handleNext} disabled={selectedAnswer === null || loadingXAI}>
                {currentQuestion < questions.length - 1 ? "Next Question" : "Finish Quiz"}
              </Button>
            </div>
          </div>

          {/* AI Chatbox */}
          <div className="lg:col-span-1">
            <Card className="h-[600px] flex flex-col bg-white/80 backdrop-blur shadow-xl border-primary/20">
              <CardHeader className="bg-primary/5 border-b">
                <CardTitle className="flex items-center gap-2">
                    <Bot className="w-5 h-5" /> AI Tutor
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-4 p-4 overflow-hidden">
                <ScrollArea className="flex-1 pr-4">
                  <div className="space-y-4">
                    {chatMessages.map((message) => (
                      <div key={message.id} className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[85%] rounded-lg p-3 text-sm ${
                            message.sender === "user" ? "bg-primary text-primary-foreground" : "bg-muted/80"
                          }`}
                        >
                          {message.text}
                        </div>
                      </div>
                    ))}
                    {loadingXAI && <div className="text-xs text-muted-foreground animate-pulse">Thinking...</div>}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}