'use client';

import { useState, useId } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  QuizContent,
  QuizQuestion,
  TextInputQuizQuestion,
  ChoiceQuizQuestion,
  parseQuizContent,
  getQuizValidationError
} from './types';
import { Alert, AlertDescription } from "@/components/ui/alert";

const isTextInputQuestion = (q: QuizQuestion): q is TextInputQuizQuestion => q.type === 'TEXT_INPUT';
const isChoiceQuestion = (q: QuizQuestion): q is ChoiceQuizQuestion =>
  q.type === 'SINGLE_CHOICE' || q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE';

interface QuizRendererProps {
  content: QuizContent | string;
}

type Answer = string | number[] | { [key: string]: string } | string[];

function orderedQuestions(content: QuizContent) {
  const questions = [...content.questions];
  if (content.shuffleQuestions) {
    for (let index = questions.length - 1; index > 0; index--) {
      const target = Math.floor(Math.random() * (index + 1));
      [questions[index], questions[target]] = [questions[target], questions[index]];
    }
  }
  return questions;
}

export function QuizRenderer({ content }: QuizRendererProps) {
  const parsed = parseQuizContent(content);
  if (!parsed) return <Alert variant="destructive"><AlertDescription>Die Quizdaten konnten nicht gelesen werden.</AlertDescription></Alert>;
  if (!parsed.questions.length) return <Card><CardHeader><CardTitle>Quiz</CardTitle></CardHeader><CardContent>Dieses Quiz enthält noch keine Fragen.</CardContent></Card>;
  const error = getQuizValidationError(parsed);
  if (error) return <Alert><AlertDescription>Dieses Quiz ist noch nicht vollständig. {error}</AlertDescription></Alert>;
  return <QuizRendererState key={JSON.stringify(parsed)} content={parsed} />;
}

function QuizRendererState({ content }: { content: QuizContent }) {
  const [questions, setQuestions] = useState(() => orderedQuestions(content));
  const quizId = useId();
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<{ [key: number]: Answer }>({});
  const [showResults, setShowResults] = useState(false);
  const [score, setScore] = useState(0);
  const [showFeedback, setShowFeedback] = useState(false);

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
      const currentAnswers = (prev[currentQuestionIndex] as number[]) || [];
      const newAnswers = currentAnswers.includes(optionIndex)
        ? currentAnswers.filter(i => i !== optionIndex)
        : [...currentAnswers, optionIndex].sort((a, b) => a - b);

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
    if (!question || selected === undefined) return false;
    const normalize = (value: string) => value.trim().toLocaleLowerCase();
    switch (question.type) {
      case 'SINGLE_CHOICE':
      case 'MULTIPLE_CHOICE':
      case 'TRUE_FALSE': {
        const answers = selected as number[];
        return Array.isArray(answers) && answers.length === question.correctAnswers.length && question.correctAnswers.every(answer => answers.includes(answer));
      }
      case 'TEXT_INPUT': {
        const answer = selected as string;
        return typeof answer === 'string' && (question.caseSensitive ? answer.trim() === question.correctAnswer.trim() : normalize(answer) === normalize(question.correctAnswer));
      }
      case 'MATCHING': {
        const answers = selected as Record<number, string>;
        return question.pairs.every((pair, index) => typeof answers?.[index] === 'string' && answers[index].trim() === pair.right.trim());
      }
      case 'FILL_BLANKS': {
        const answers = selected as string[];
        return question.answers.every((answer, index) => typeof answers?.[index] === 'string' && normalize(answers[index]) === normalize(answer));
      }
      default: return false;
    }
  };

  const hasCompleteAnswer = () => {
    const answer = selectedAnswers[currentQuestionIndex];
    switch (currentQuestion.type) {
      case 'SINGLE_CHOICE':
      case 'TRUE_FALSE': return Array.isArray(answer) && answer.length === 1;
      case 'MULTIPLE_CHOICE': return Array.isArray(answer) && answer.length > 0;
      case 'TEXT_INPUT': return typeof answer === 'string' && !!answer.trim();
      case 'MATCHING': return currentQuestion.pairs.every((_, index) => typeof (answer as Record<number, string>)?.[index] === 'string' && !!(answer as Record<number, string>)[index].trim());
      case 'FILL_BLANKS': return currentQuestion.answers.every((_, index) => typeof (answer as string[])?.[index] === 'string' && !!(answer as string[])[index].trim());
      default: return false;
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
      const correctAnswers = questions.reduce((total, _, index) => total + (isAnswerCorrect(index) ? 1 : 0), 0);
      setScore((correctAnswers / questions.length) * 100);
      setShowResults(true);
    }
  };

  const handleRetry = () => {
    setQuestions(orderedQuestions(content));
    setCurrentQuestionIndex(0);
    setSelectedAnswers({});
    setShowResults(false);
    setScore(0);
    setShowFeedback(false);
  };

  if (showResults) {
    const passingScore = content.passingScore ?? 70;
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
                  {!isAnswerCorrect(index) && isChoiceQuestion(q) && (
                    <span className="block text-sm">
                      Richtige Antwort: {
                        q.correctAnswers
                          .map(i => q.options[i])
                          .join(', ')
                      }
                    </span>
                  )}
                  {!isAnswerCorrect(index) && isTextInputQuestion(q) && (
                    <span className="block text-sm">
                      Richtige Antwort: {q.correctAnswer}
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
          <Button type="button" onClick={handleRetry}>Quiz wiederholen</Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Frage {currentQuestionIndex + 1} von {questions.length}</CardTitle>
          {currentQuestion.type === 'MULTIPLE_CHOICE' && (
            <span className="text-sm text-muted-foreground">(Mehrfachauswahl möglich)</span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <p className="break-words text-lg font-medium">{currentQuestion.question}</p>

          {currentQuestion.type === 'TEXT_INPUT' && (
            <div className="space-y-2">
              <Input
                aria-label="Deine Antwort"
                value={(selectedAnswers[currentQuestionIndex] as string) || ''}
                onChange={(e) => handleTextInputAnswer(e.target.value)}
                placeholder="Deine Antwort"
                disabled={showFeedback}
              />
            </div>
          )}

          {currentQuestion.type === 'MATCHING' && (
            <div className="space-y-4">
              {currentQuestion.pairs.map((pair, index) => (
                <div key={index} className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <div className="min-w-0 w-full flex-1">{pair.left}</div>
                  <Input
                    aria-label={`Zuordnung für ${pair.left}`}
                    value={((selectedAnswers[currentQuestionIndex] as { [key: string]: string })?.[index]) || ''}
                    onChange={(e) => handleMatchingAnswer(index, e.target.value)}
                    placeholder="Passende Antwort..."
                    disabled={showFeedback}
                    className="min-w-0 w-full flex-1"
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
                    aria-label={`Lücke ${index + 1}`}
                    value={((selectedAnswers[currentQuestionIndex] as string[])?.[index]) || ''}
                    onChange={(e) => handleFillBlanksAnswer(index, e.target.value)}
                    placeholder={`Lücke ${index + 1}`}
                    disabled={showFeedback}
                  />
                ))}
              </div>
            </div>
          )}

          {currentQuestion.type === 'MULTIPLE_CHOICE' && (
            <div className="space-y-2">
              {currentQuestion.options.map((option, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <Checkbox
                    id={`${quizId}-${currentQuestion.id}-option-${index}`}
                    checked={(selectedAnswers[currentQuestionIndex] as number[] || []).includes(index)}
                    onCheckedChange={() => handleMultipleAnswerSelect(index)}
                    disabled={showFeedback}
                  />
                  <Label htmlFor={`${quizId}-${currentQuestion.id}-option-${index}`}>{option}</Label>
                </div>
              ))}
            </div>
          )}

          {(currentQuestion.type === 'SINGLE_CHOICE' || currentQuestion.type === 'TRUE_FALSE') && (
            <RadioGroup
              onValueChange={handleSingleAnswerSelect}
              value={((selectedAnswers[currentQuestionIndex] as number[])?.[0]?.toString()) ?? ""}
              disabled={showFeedback}
            >
              <div className="space-y-2">
                {currentQuestion.options.map((option, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    <RadioGroupItem value={index.toString()} id={`${quizId}-${currentQuestion.id}-option-${index}`} />
                    <Label htmlFor={`${quizId}-${currentQuestion.id}-option-${index}`}>{option}</Label>
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
                        <span>Richtige Antwort: {currentQuestion.correctAnswer}</span>
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
          type="button"
          onClick={handleNext}
          disabled={!showFeedback && !hasCompleteAnswer()}
        >
          {!showFeedback ? 'Antwort prüfen' :
            currentQuestionIndex < questions.length - 1 ? 'Nächste Frage' : 'Quiz beenden'}
        </Button>
      </CardFooter>
    </Card>
  );
}
