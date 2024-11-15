'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { QuizContent, QuizQuestion } from './types';
import { Alert, AlertDescription } from "@/components/ui/alert";

interface QuizRendererProps {
  content: QuizContent;
}

export function QuizRenderer({ content }: QuizRendererProps) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<number[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [score, setScore] = useState(0);
  const [showFeedback, setShowFeedback] = useState(false);

  // Handle empty or invalid quiz content
  if (!content?.questions || content.questions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Quiz</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertDescription>
              Dieses Quiz enthält noch keine Fragen.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const questions = content.shuffleQuestions 
    ? [...content.questions].sort(() => Math.random() - 0.5)
    : content.questions;

  const currentQuestion = questions[currentQuestionIndex];

  const handleAnswerSelect = (value: string) => {
    const answerIndex = parseInt(value);
    const newAnswers = [...selectedAnswers];
    newAnswers[currentQuestionIndex] = answerIndex;
    setSelectedAnswers(newAnswers);
    setShowFeedback(false); // Reset feedback when selecting a new answer
  };

  const handleNext = () => {
    if (!showFeedback) {
      setShowFeedback(true);
      return;
    }

    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setShowFeedback(false);
    } else {
      // Calculate score
      const correctAnswers = selectedAnswers.reduce((acc, answer, index) => {
        return acc + (answer === questions[index].correctAnswer ? 1 : 0);
      }, 0);
      setScore((correctAnswers / questions.length) * 100);
      setShowResults(true);
    }
  };

  const handleRetry = () => {
    setCurrentQuestionIndex(0);
    setSelectedAnswers([]);
    setShowResults(false);
    setScore(0);
    setShowFeedback(false);
  };

  if (showResults) {
    const passingScore = content.passingScore || 70;
    const passed = score >= passingScore;

    return (
      <Card>
        <CardHeader>
          <CardTitle>Quiz Ergebnisse</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant={passed ? "default" : "destructive"}>
            <AlertDescription>
              Du hast {score.toFixed(1)}% erreicht
              {passed ? ' - Bestanden!' : ' - Nicht bestanden.'}
            </AlertDescription>
          </Alert>
          <div className="space-y-4">
            {questions.map((q, index) => (
              <div key={index} className="space-y-2">
                <p className="font-medium">{q.question}</p>
                <p className={selectedAnswers[index] === q.correctAnswer ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                  {selectedAnswers[index] === q.correctAnswer ? "✓ Richtig" : "✗ Falsch"}
                  {selectedAnswers[index] !== q.correctAnswer && (
                    <span className="block text-sm">
                      Richtige Antwort: {q.options[q.correctAnswer]}
                    </span>
                  )}
                </p>
                {q.explanation && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {q.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleRetry}>Quiz wiederholen</Button>
        </CardFooter>
      </Card>
    );
  }

  const isAnswerCorrect = selectedAnswers[currentQuestionIndex] === currentQuestion.correctAnswer;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Frage {currentQuestionIndex + 1} von {questions.length}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-lg font-medium">{currentQuestion.question}</p>
          <RadioGroup
            onValueChange={handleAnswerSelect}
            value={selectedAnswers[currentQuestionIndex]?.toString() || undefined}
            disabled={showFeedback}
          >
            <div className="space-y-2">
              {currentQuestion.options.map((option, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <RadioGroupItem value={index.toString()} id={`option-${index}`} />
                  <Label htmlFor={`option-${index}`}>{option}</Label>
                </div>
              ))}
            </div>
          </RadioGroup>
          
          {showFeedback && (
            <Alert variant={isAnswerCorrect ? "default" : "destructive"} className="mt-4">
              <AlertDescription>
                {isAnswerCorrect ? (
                  <span className="text-green-600 dark:text-green-400">✓ Richtig!</span>
                ) : (
                  <div className="space-y-1">
                    <span className="text-red-600 dark:text-red-400">✗ Falsch</span>
                    <p>Richtige Antwort: {currentQuestion.options[currentQuestion.correctAnswer]}</p>
                  </div>
                )}
                {currentQuestion.explanation && (
                  <p className="mt-2">{currentQuestion.explanation}</p>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <Button 
          onClick={handleNext}
        >
          {!showFeedback ? 'Antwort prüfen' : 
           currentQuestionIndex < questions.length - 1 ? 'Nächste Frage' : 'Quiz beenden'}
        </Button>
      </CardFooter>
    </Card>
  );
}
