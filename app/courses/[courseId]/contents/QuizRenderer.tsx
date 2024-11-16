'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { QuizContent, QuizQuestion } from './types';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface QuizRendererProps {
  content: QuizContent;
}

type Answer = string | number[] | { [key: string]: string } | string[];

export function QuizRenderer({ content }: QuizRendererProps) {
  const [questions] = useState(() => 
    content.shuffleQuestions 
      ? [...content.questions].sort(() => Math.random() - 0.5)
      : content.questions
  );
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<{ [key: number]: Answer }>({});
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

  const currentQuestion = questions[currentQuestionIndex];

  const handleSingleAnswerSelect = (value: string) => {
    const answerIndex = parseInt(value);
    setSelectedAnswers(prev => ({
      ...prev,
      [currentQuestionIndex]: [answerIndex]
    }));
    setShowFeedback(false);
  };

  const handleMultipleAnswerSelect = (optionIndex: number) => {
    setSelectedAnswers(prev => {
      const currentAnswers = prev[currentQuestionIndex] || [];
      const newAnswers = currentAnswers.includes(optionIndex)
        ? currentAnswers.filter(i => i !== optionIndex)
        : [...currentAnswers, optionIndex].sort();
      
      return {
        ...prev,
        [currentQuestionIndex]: newAnswers
      };
    });
    setShowFeedback(false);
  };

  const handleTextInputAnswer = (value: string) => {
    setSelectedAnswers(prev => ({
      ...prev,
      [currentQuestionIndex]: value
    }));
    setShowFeedback(false);
  };

  const handleMatchingAnswer = (leftIndex: number, value: string) => {
    setSelectedAnswers(prev => {
      const currentAnswers = (prev[currentQuestionIndex] as { [key: string]: string }) || {};
      return {
        ...prev,
        [currentQuestionIndex]: {
          ...currentAnswers,
          [leftIndex]: value
        }
      };
    });
    setShowFeedback(false);
  };

  const handleFillBlanksAnswer = (index: number, value: string) => {
    setSelectedAnswers(prev => {
      const currentAnswers = (prev[currentQuestionIndex] as string[]) || [];
      const newAnswers = [...currentAnswers];
      newAnswers[index] = value;
      return {
        ...prev,
        [currentQuestionIndex]: newAnswers
      };
    });
    setShowFeedback(false);
  };

  const isAnswerCorrect = (questionIndex: number) => {
    const question = questions[questionIndex];
    const selected = selectedAnswers[questionIndex];

    switch (question.type) {
      case 'SINGLE_CHOICE':
      case 'MULTIPLE_CHOICE':
      case 'TRUE_FALSE': {
        const selectedArray = selected as number[];
        const correct = question.correctAnswers;
        return question.type === 'MULTIPLE_CHOICE'
          ? selectedArray?.length === correct.length && selectedArray.every(answer => correct.includes(answer))
          : selectedArray?.[0] === correct[0];
      }
      
      case 'TEXT_INPUT': {
        const answer = selected as string;
        const correctAnswer = (question as any).correctAnswer;
        return question.caseSensitive
          ? answer === correctAnswer
          : answer?.toLowerCase() === correctAnswer.toLowerCase();
      }

      case 'MATCHING': {
        const answers = selected as { [key: string]: string };
        return question.pairs.every((pair, index) => 
          answers?.[index] === pair.right
        );
      }

      case 'FILL_BLANKS': {
        const answers = selected as string[];
        return answers?.every((answer, index) =>
          answer?.toLowerCase() === question.answers[index].toLowerCase()
        );
      }

      default:
        return false;
    }
  };

  const handleNext = () => {
    if (!showFeedback) {
      setShowFeedback(true);
      return;
    }

    if (currentQuestionIndex < questions.length - 1) {
      setSelectedAnswers(prev => {
        const next = { ...prev };
        delete next[currentQuestionIndex + 1];
        return next;
      });
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setShowFeedback(false);
    } else {
      // Calculate score
      const correctAnswers = Object.keys(selectedAnswers).reduce((acc, index) => {
        return acc + (isAnswerCorrect(parseInt(index)) ? 1 : 0);
      }, 0);
      setScore((correctAnswers / questions.length) * 100);
      setShowResults(true);
    }
  };

  const handleRetry = () => {
    setCurrentQuestionIndex(0);
    setSelectedAnswers({});
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
                <p className={isAnswerCorrect(index) ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                  {isAnswerCorrect(index) ? "✓ Richtig" : "✗ Falsch"}
                  {!isAnswerCorrect(index) && (
                    <span className="block text-sm">
                      Richtige Antwort: {
                        (q.correctAnswers || [q.correctAnswer])
                          .map(i => q.options[i])
                          .join(', ')
                      }
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Frage {currentQuestionIndex + 1} von {questions.length}</CardTitle>
          {currentQuestion.type === 'MULTIPLE_CHOICE' && (
            <span className="text-sm text-muted-foreground">(Mehrfachauswahl möglich)</span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="text-lg font-medium">{currentQuestion.question}</p>
          
          {currentQuestion.type === 'TEXT_INPUT' && (
            <div className="space-y-2">
              <Input
                value={(selectedAnswers[currentQuestionIndex] as string) || ''}
                onChange={(e) => handleTextInputAnswer(e.target.value)}
                placeholder="Geben Sie Ihre Antwort ein..."
                disabled={showFeedback}
              />
            </div>
          )}

          {currentQuestion.type === 'MATCHING' && (
            <div className="space-y-4">
              {currentQuestion.pairs.map((pair, index) => (
                <div key={index} className="flex items-center gap-4">
                  <div className="flex-1">{pair.left}</div>
                  <Input
                    value={((selectedAnswers[currentQuestionIndex] as { [key: string]: string })?.[index]) || ''}
                    onChange={(e) => handleMatchingAnswer(index, e.target.value)}
                    placeholder="Passende Antwort..."
                    disabled={showFeedback}
                    className="flex-1"
                  />
                </div>
              ))}
            </div>
          )}

          {currentQuestion.type === 'FILL_BLANKS' && (
            <div className="space-y-4">
              <p className="text-base">{currentQuestion.text}</p>
              <div className="space-y-2">
                {currentQuestion.answers.map((_, index) => (
                  <Input
                    key={index}
                    value={((selectedAnswers[currentQuestionIndex] as string[])?.[index]) || ''}
                    onChange={(e) => handleFillBlanksAnswer(index, e.target.value)}
                    placeholder={`Lücke ${index + 1}`}
                    disabled={showFeedback}
                  />
                ))}
              </div>
            </div>
          )}

          {(currentQuestion.type === 'MULTIPLE_CHOICE' || currentQuestion.type === 'TRUE_FALSE') && (
            <div className="space-y-2">
              {currentQuestion.options.map((option, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <Checkbox
                    id={`option-${index}`}
                    checked={(selectedAnswers[currentQuestionIndex] as number[] || []).includes(index)}
                    onCheckedChange={() => handleMultipleAnswerSelect(index)}
                    disabled={showFeedback}
                  />
                  <Label htmlFor={`option-${index}`}>{option}</Label>
                </div>
              ))}
            </div>
          )}

          {currentQuestion.type === 'SINGLE_CHOICE' && (
            <RadioGroup
              onValueChange={handleSingleAnswerSelect}
              value={((selectedAnswers[currentQuestionIndex] as number[])?.[0]?.toString()) ?? ""}
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
          )}

          {showFeedback && (
            <Alert variant={isAnswerCorrect(currentQuestionIndex) ? "default" : "destructive"}>
              <AlertDescription>
                {isAnswerCorrect(currentQuestionIndex) ? (
                  "✓ Richtig!"
                ) : (
                  <>
                    ✗ Falsch
                    <div className="mt-2">
                      {currentQuestion.type === 'TEXT_INPUT' && (
                        <span>Richtige Antwort: {(currentQuestion as any).correctAnswer}</span>
                      )}
                      {currentQuestion.type === 'MATCHING' && (
                        <div className="space-y-1">
                          <span>Richtige Zuordnung:</span>
                          {currentQuestion.pairs.map((pair, index) => (
                            <div key={index}>
                              {pair.left} ➔ {pair.right}
                            </div>
                          ))}
                        </div>
                      )}
                      {currentQuestion.type === 'FILL_BLANKS' && (
                        <div className="space-y-1">
                          <span>Richtige Antworten:</span>
                          {currentQuestion.answers.map((answer, index) => (
                            <div key={index}>
                              Lücke {index + 1}: {answer}
                            </div>
                          ))}
                        </div>
                      )}
                      {(currentQuestion.type === 'SINGLE_CHOICE' || currentQuestion.type === 'MULTIPLE_CHOICE' || currentQuestion.type === 'TRUE_FALSE') && (
                        <span>
                          Richtige Antwort: {
                            currentQuestion.correctAnswers
                              .map(i => currentQuestion.options[i])
                              .join(', ')
                          }
                        </span>
                      )}
                    </div>
                  </>
                )}
                {currentQuestion.explanation && (
                  <p className="mt-2 text-sm">
                    {currentQuestion.explanation}
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <Button 
          onClick={handleNext}
          disabled={
            !selectedAnswers[currentQuestionIndex] ||
            (currentQuestion.type === 'MATCHING' && 
              !currentQuestion.pairs.every((_, index) => 
                ((selectedAnswers[currentQuestionIndex] as { [key: string]: string })?.[index])
              ))
          }
        >
          {!showFeedback ? 'Antwort prüfen' : 
           currentQuestionIndex < questions.length - 1 ? 'Nächste Frage' : 'Quiz beenden'}
        </Button>
      </CardFooter>
    </Card>
  );
}
