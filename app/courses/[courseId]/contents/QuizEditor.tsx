'use client';

import { useState, useRef, useEffect, useEffectEvent, useId } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { PlusCircle, Trash2, GripVertical, Eye, ArrowUpDown, ArrowUp, ArrowDown, CheckSquare, Square } from 'lucide-react';
import {
  QuizContent,
  QuizQuestion,
  QuestionType,
  MatchingQuizQuestion,
  TextInputQuizQuestion,
  FillBlanksQuizQuestion,
  ChoiceQuizQuestion,
  getQuizValidationError
} from './types';
import { cn } from '@/lib/utils';
import { quizEditorDraft } from './content-form-utils';
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface QuizEditorProps {
  initialContent?: QuizContent | string;
  onSave: (content: QuizContent) => void | Promise<void>;
  onChange?: (content: QuizContent) => void;
  showSaveButton?: boolean;
  disabled?: boolean;
}

// Local interfaces removed as they are now imported from ./types

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'SINGLE_CHOICE', label: 'Einfachauswahl' },
  { value: 'MULTIPLE_CHOICE', label: 'Mehrfachauswahl' },
  { value: 'TRUE_FALSE', label: 'Wahr/Falsch' },
  { value: 'TEXT_INPUT', label: 'Freitext' },
  { value: 'MATCHING', label: 'Zuordnung' },
  { value: 'FILL_BLANKS', label: 'Lückentext' },
];

const createEmptyQuestion = (type: QuestionType = 'SINGLE_CHOICE'): QuizQuestion => {
  const baseQuestion = {
    id: globalThis.crypto?.randomUUID?.() ?? `question-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    question: '',
    type,
  };

  switch (type) {
    case 'SINGLE_CHOICE':
    case 'MULTIPLE_CHOICE':
      return {
        ...baseQuestion,
        type,
        options: ['', ''],
        correctAnswers: [],
      };
    case 'TRUE_FALSE':
      return {
        ...baseQuestion,
        type,
        options: ['Wahr', 'Falsch'],
        correctAnswers: [0],
      };
    case 'TEXT_INPUT':
      return {
        ...baseQuestion,
        type,
        correctAnswer: '',
        caseSensitive: false,
      };
    case 'MATCHING':
      return {
        ...baseQuestion,
        type,
        pairs: [
          { left: '', right: '' },
          { left: '', right: '' }
        ],
      };
    case 'FILL_BLANKS':
      return {
        ...baseQuestion,
        type,
        text: '',
        answers: [''],
      };
    default:
      return {
        ...baseQuestion,
        type: 'SINGLE_CHOICE',
        options: ['', ''],
        correctAnswers: [],
      };
  }
};

const isMatchingQuestion = (q: QuizQuestion): q is MatchingQuizQuestion => q.type === 'MATCHING';
const isTextInputQuestion = (q: QuizQuestion): q is TextInputQuizQuestion => q.type === 'TEXT_INPUT';
const isFillBlanksQuestion = (q: QuizQuestion): q is FillBlanksQuizQuestion => q.type === 'FILL_BLANKS';
const isChoiceQuestion = (q: QuizQuestion): q is ChoiceQuizQuestion =>
  q.type === 'SINGLE_CHOICE' || q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE';

export function QuizEditor({ initialContent, onSave, onChange, showSaveButton = true, disabled = false }: QuizEditorProps) {
  const [initialQuiz] = useState(() => initialContent === undefined ? { questions: [], shuffleQuestions: false, passingScore: 70 } as QuizContent : quizEditorDraft(initialContent));
  const [questions, setQuestions] = useState<QuizQuestion[]>(initialQuiz?.questions ?? []);
  const [shuffleQuestions, setShuffleQuestions] = useState(initialQuiz?.shuffleQuestions ?? false);
  const [passingScore, setPassingScore] = useState(() => Number.isFinite(initialQuiz?.passingScore ?? 70) ? String(initialQuiz?.passingScore ?? 70) : '');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const questionTypesRef = useRef(new Map<string, QuizQuestion>());
  const formId = useId();
  const draft = (): QuizContent => ({ ...initialQuiz, questions, shuffleQuestions, passingScore: passingScore.trim() ? Number(passingScore) : NaN });
  const notifyChange = useEffectEvent(() => { if (initialQuiz) onChange?.(draft()); });
  useEffect(() => { notifyChange(); }, [questions, shuffleQuestions, passingScore]);
  const [draggedQuestionIndex, setDraggedQuestionIndex] = useState<number | null>(null);
  const [dragOverQuestionIndex, setDragOverQuestionIndex] = useState<number | null>(null);

  const moveQuestion = (fromIndex: number, toIndex: number) => {
    const newQuestions = [...questions];
    const [movedQuestion] = newQuestions.splice(fromIndex, 1);
    newQuestions.splice(toIndex, 0, movedQuestion);
    setQuestions(newQuestions);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    setDraggedQuestionIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverQuestionIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedQuestionIndex(null);
    setDragOverQuestionIndex(null);
  };

  const handleDrop = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    if (draggedQuestionIndex !== null) moveQuestion(draggedQuestionIndex, index);
    handleDragEnd();
  };

  const addQuestion = () => {
    setQuestions([
      ...questions,
      createEmptyQuestion(),
    ]);
  };

  const removeQuestion = (index: number) => {
    setQuestions(questions.filter((_, i) => i !== index));
  };

  const updateQuestion = (questionIndex: number, field: string, value: any) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex) return q;

      if (field === 'type') {
        // When changing question type, create a new question of that type
        // while preserving the question text and explanation
        const nextType = value as QuestionType;
        if (nextType === q.type) return q;
        questionTypesRef.current.set(`${q.id}:${q.type}`, q);
        let newQuestion = questionTypesRef.current.get(`${q.id}:${nextType}`) ?? createEmptyQuestion(nextType);
        if (isChoiceQuestion(q) && (nextType === 'SINGLE_CHOICE' || nextType === 'MULTIPLE_CHOICE') && !questionTypesRef.current.has(`${q.id}:${nextType}`)) {
          newQuestion = { ...q, type: nextType, options: [...q.options], correctAnswers: nextType === 'SINGLE_CHOICE' ? q.correctAnswers.slice(0, 1) : [...q.correctAnswers] };
        }
        return {
          ...newQuestion,
          id: q.id,
          question: q.question,
          explanation: q.explanation,
        };
      }

      return {
        ...q,
        [field]: value,
      };
    }));
  };

  const toggleCorrectAnswer = (questionIndex: number, optionIndex: number) => {
    setQuestions(previous => previous.map((question, index) => {
      if (index !== questionIndex || !isChoiceQuestion(question)) return question;
      const correctAnswers = question.type !== 'MULTIPLE_CHOICE' ? [optionIndex]
        : question.correctAnswers.includes(optionIndex) ? question.correctAnswers.filter(answer => answer !== optionIndex)
          : [...question.correctAnswers, optionIndex].sort((a, b) => a - b);
      return { ...question, correctAnswers };
    }));
  };

  const isCorrectAnswer = (questionIndex: number, optionIndex: number) => {
    const question = questions[questionIndex];
    if (!question || !isChoiceQuestion(question) || !Array.isArray(question.correctAnswers)) return false;
    return question.correctAnswers.includes(optionIndex);
  };

  const addOption = (questionIndex: number) => {
    setQuestions(previous => previous.map((question, index) => index === questionIndex && isChoiceQuestion(question) && question.type !== 'TRUE_FALSE' && question.options.length < 6
      ? { ...question, options: [...question.options, ''] } : question));
  };

  const removeOption = (questionIndex: number, optionIndex: number) => {
    setQuestions(previous => previous.map((question, index) => index === questionIndex && isChoiceQuestion(question) && question.type !== 'TRUE_FALSE' && question.options.length > 2
      ? { ...question, options: question.options.filter((_, option) => option !== optionIndex), correctAnswers: question.correctAnswers.filter(answer => answer !== optionIndex).map(answer => answer > optionIndex ? answer - 1 : answer) } : question));
  };

  const updateOption = (questionIndex: number, optionIndex: number, value: string) => {
    setQuestions(previous => previous.map((question, index) => index === questionIndex && isChoiceQuestion(question)
      ? { ...question, options: question.options.map((option, optionNumber) => optionNumber === optionIndex ? value : option) } : question));
  };

  const moveQuestionUp = (index: number) => {
    if (index > 0) {
      moveQuestion(index, index - 1);
    }
  };

  const moveQuestionDown = (index: number) => {
    if (index < questions.length - 1) {
      moveQuestion(index, index + 1);
    }
  };

  const handleSave = async () => {
    if (isSaving || disabled) return;
    const content = draft();
    const error = getQuizValidationError(content);
    setValidationError(error);
    if (error) return;
    setIsSaving(true);
    try { await onSave(content); }
    catch (error) { setValidationError(error instanceof Error ? error.message : 'Das Quiz konnte nicht gespeichert werden.'); }
    finally { setIsSaving(false); }
  };

  const updateMatchingPair = (questionIndex: number, pairIndex: number, side: 'left' | 'right', value: string) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isMatchingQuestion(q)) return q;
      const newPairs = [...q.pairs];
      newPairs[pairIndex] = {
        ...newPairs[pairIndex],
        [side]: value
      };
      return {
        ...q,
        pairs: newPairs
      };
    }));
  };

  const addMatchingPair = (questionIndex: number) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isMatchingQuestion(q)) return q;
      return {
        ...q,
        pairs: [...q.pairs, { left: '', right: '' }]
      };
    }));
  };

  const removeMatchingPair = (questionIndex: number, pairIndex: number) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isMatchingQuestion(q)) return q;
      return {
        ...q,
        pairs: q.pairs.filter((_, index) => index !== pairIndex)
      };
    }));
  };

  const updateTextInputAnswer = (questionIndex: number, value: string) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isTextInputQuestion(q)) return q;
      return {
        ...q,
        correctAnswer: value
      };
    }));
  };

  const updateFillBlanksAnswer = (questionIndex: number, answerIndex: number, value: string) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isFillBlanksQuestion(q)) return q;
      const newAnswers = [...q.answers];
      newAnswers[answerIndex] = value;
      return {
        ...q,
        answers: newAnswers
      };
    }));
  };

  const addFillBlanksAnswer = (questionIndex: number) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isFillBlanksQuestion(q)) return q;
      return {
        ...q,
        answers: [...q.answers, '']
      };
    }));
  };

  const removeFillBlanksAnswer = (questionIndex: number, answerIndex: number) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isFillBlanksQuestion(q)) return q;
      return {
        ...q,
        answers: q.answers.filter((_, index) => index !== answerIndex)
      };
    }));
  };

  if (!initialQuiz) return <Alert variant="destructive"><AlertDescription>Die gespeicherten Quizdaten konnten nicht gelesen werden. Der vorhandene Inhalt bleibt erhalten.</AlertDescription></Alert>;

  return (
    <fieldset disabled={disabled || isSaving} className="min-w-0 space-y-4">
      <Tabs defaultValue="edit" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="edit">Bearbeiten</TabsTrigger>
          <TabsTrigger value="preview">Vorschau</TabsTrigger>
        </TabsList>

        <TabsContent value="edit">
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowUpDown className="h-5 w-5" />
                Quiz Einstellungen
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <Label htmlFor={`${formId}-shuffle`} className="font-medium">Fragen mischen</Label>
                <Switch
                  id={`${formId}-shuffle`}
                  checked={shuffleQuestions}
                  onCheckedChange={setShuffleQuestions}
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <Label htmlFor={`${formId}-passing-score`} className="font-medium">Bestehensgrenze (%)</Label>
                <Input
                  id={`${formId}-passing-score`}
                  type="number"
                  min="0"
                  max="100"
                  value={passingScore}
                  onChange={(e) => setPassingScore(e.target.value)}
                  className="w-full sm:w-24"
                />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-8">
            {questions.map((question, questionIndex) => (
              <Card
                key={question.id}
                className={cn(
                  "transition-colors duration-200",
                  draggedQuestionIndex === questionIndex && "opacity-50 scale-95",
                  "relative border-2",
                  draggedQuestionIndex !== null && dragOverQuestionIndex === questionIndex && "border-primary border-dashed"
                )}
                onDragOver={(e) => handleDragOver(e, questionIndex)}
                onDrop={(e) => handleDrop(e, questionIndex)}
                onDragEnd={handleDragEnd}
              >
                <div className="flex flex-wrap justify-end gap-2 px-4 pt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Frage ${questionIndex + 1} nach oben verschieben`}
                    onClick={() => moveQuestionUp(questionIndex)}
                    disabled={questionIndex === 0}
                    className="hover:bg-accent"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Frage ${questionIndex + 1} nach unten verschieben`}
                    onClick={() => moveQuestionDown(questionIndex)}
                    disabled={questionIndex === questions.length - 1}
                    className="hover:bg-accent"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Frage ${questionIndex + 1} löschen`}
                    onClick={() => removeQuestion(questionIndex)}
                    className="text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <CardHeader className="cursor-move select-none" draggable={!disabled && !isSaving} onDragStart={(event) => handleDragStart(event, questionIndex)}>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1">
                      <GripVertical className="h-5 w-5 text-muted-foreground" />
                      <CardTitle>Frage {questionIndex + 1}</CardTitle>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor={`question-${question.id}`} className="text-base font-medium">Frage</Label>
                    <Textarea
                      id={`question-${question.id}`}
                      value={question.question}
                      onChange={(e) => updateQuestion(questionIndex, 'question', e.target.value)}
                      placeholder="Frage"
                      className="min-h-[100px] resize-y"
                    />
                  </div>

                  <div className="space-y-3">
                    <Label className="text-base font-medium">Fragetyp</Label>
                    <Select
                      value={question.type}
                      onValueChange={(value) => updateQuestion(questionIndex, 'type', value)}
                    >
                      <SelectTrigger aria-label={`Fragetyp für Frage ${questionIndex + 1}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUESTION_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {question.type === 'MATCHING' && isMatchingQuestion(question) && (
                    <div className="space-y-3">
                      <Label className="text-base font-medium">Paare</Label>
                      {question.pairs.map((pair, pairIndex) => (
                        <div key={pairIndex} className="flex items-center gap-3">
                          <Input
                            aria-label={`Frage ${questionIndex + 1}, Paar ${pairIndex + 1}, linker Teil`}
                            value={pair.left}
                            onChange={(e) => updateMatchingPair(questionIndex, pairIndex, 'left', e.target.value)}
                            placeholder="Linker Teil"
                            className="flex-1"
                          />
                          <Input
                            aria-label={`Frage ${questionIndex + 1}, Paar ${pairIndex + 1}, rechter Teil`}
                            value={pair.right}
                            onChange={(e) => updateMatchingPair(questionIndex, pairIndex, 'right', e.target.value)}
                            placeholder="Rechter Teil"
                            className="flex-1"
                          />
                          {question.pairs.length > 2 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Paar ${pairIndex + 1} entfernen`}
                              onClick={() => removeMatchingPair(questionIndex, pairIndex)}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      {question.pairs.length < 6 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addMatchingPair(questionIndex)}
                          className="mt-2 w-full"
                        >
                          <PlusCircle className="h-4 w-4 mr-2" />
                          Paar hinzufügen
                        </Button>
                      )}
                    </div>
                  )}

                  {question.type === 'TEXT_INPUT' && isTextInputQuestion(question) && (
                    <div className="space-y-3">
                      <Label className="text-base font-medium">Richtige Antwort</Label>
                      <Input
                        aria-label={`Richtige Antwort für Frage ${questionIndex + 1}`}
                        value={question.correctAnswer}
                        onChange={(e) => updateTextInputAnswer(questionIndex, e.target.value)}
                        placeholder="Richtige Antwort"
                        className="w-full"
                      />
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`case-sensitive-${questionIndex}`}
                          checked={question.caseSensitive}
                          onCheckedChange={(checked) =>
                            updateQuestion(questionIndex, 'caseSensitive', checked)
                          }
                        />
                        <Label htmlFor={`case-sensitive-${questionIndex}`}>
                          Groß-/Kleinschreibung beachten
                        </Label>
                      </div>
                    </div>
                  )}

                  {question.type === 'FILL_BLANKS' && isFillBlanksQuestion(question) && (
                    <div className="space-y-3">
                      <Label className="text-base font-medium">Text mit Lücken</Label>
                      <Textarea
                        aria-label={`Lückentext für Frage ${questionIndex + 1}`}
                        value={question.text}
                        onChange={(e) => updateQuestion(questionIndex, 'text', e.target.value)}
                        placeholder="Text mit [Lücken] in eckigen Klammern"
                        className="min-h-[100px]"
                      />
                      <Label className="text-base font-medium">Antworten für Lücken</Label>
                      {question.answers.map((answer, answerIndex) => (
                        <div key={answerIndex} className="flex items-center gap-3">
                          <div className="bg-muted rounded-full px-2 py-1 text-sm font-medium text-muted-foreground">
                            {answerIndex + 1}
                          </div>
                          <Input
                            aria-label={`Frage ${questionIndex + 1}, Antwort für Lücke ${answerIndex + 1}`}
                            value={answer}
                            onChange={(e) => updateFillBlanksAnswer(questionIndex, answerIndex, e.target.value)}
                            placeholder={`Antwort für Lücke ${answerIndex + 1}`}
                            className="flex-1"
                          />
                          {question.answers.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={`Lücke ${answerIndex + 1} entfernen`}
                              onClick={() => removeFillBlanksAnswer(questionIndex, answerIndex)}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addFillBlanksAnswer(questionIndex)}
                        className="mt-2 w-full"
                      >
                        <PlusCircle className="h-4 w-4 mr-2" />
                        Antwort hinzufügen
                      </Button>
                    </div>
                  )}

                  {(question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE') && (
                    <div className="space-y-3">
                      <Label className="text-base font-medium">Antwortmöglichkeiten</Label>
                      {question.options.map((option, optionIndex) => (
                        <div key={optionIndex} className="flex items-center gap-3">
                          <div className="min-w-0 flex-1 flex items-center gap-3">
                            <div className="bg-muted rounded-full px-2 py-1 text-sm font-medium text-muted-foreground">
                              {String.fromCharCode(65 + optionIndex)}
                            </div>
                            <Input
                              aria-label={`Frage ${questionIndex + 1}, Option ${optionIndex + 1}`}
                              value={option}
                              onChange={(e) => updateOption(questionIndex, optionIndex, e.target.value)}
                              placeholder={`Option ${optionIndex + 1}`}
                              className={cn(
                                "flex-1",
                                isCorrectAnswer(questionIndex, optionIndex) && "border-primary ring-1 ring-primary"
                              )}
                            />
                            <Button
                              type="button"
                              variant={isCorrectAnswer(questionIndex, optionIndex) ? "default" : "outline"}
                              size="sm"
                              aria-label={`Frage ${questionIndex + 1}, Option ${optionIndex + 1} als richtig markieren`}
                              aria-pressed={isCorrectAnswer(questionIndex, optionIndex)}
                              onClick={() => toggleCorrectAnswer(questionIndex, optionIndex)}
                              className={cn(
                                "min-w-[40px]",
                                isCorrectAnswer(questionIndex, optionIndex) && "bg-primary hover:bg-primary/90"
                              )}
                            >
                              {question.type === 'MULTIPLE_CHOICE' ? (
                                isCorrectAnswer(questionIndex, optionIndex) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />
                              ) : (
                                "✓"
                              )}
                            </Button>
                            {question.options.length > 2 && question.type !== 'TRUE_FALSE' && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={`Frage ${questionIndex + 1}, Option ${optionIndex + 1} entfernen`}
                                onClick={() => removeOption(questionIndex, optionIndex)}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                      {question.options.length < 6 && question.type !== 'TRUE_FALSE' && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => addOption(questionIndex)}
                          className="mt-2 w-full"
                        >
                          <PlusCircle className="h-4 w-4 mr-2" />
                          Option hinzufügen
                        </Button>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label className="text-base font-medium">Erklärung (optional)</Label>
                    <Textarea
                      aria-label={`Erklärung für Frage ${questionIndex + 1}`}
                      value={question.explanation ?? ''}
                      onChange={(e) => updateQuestion(questionIndex, 'explanation', e.target.value)}
                      placeholder="Antwort erläutern"
                      className="min-h-[100px] resize-y"
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Button

            type="button"
            onClick={addQuestion}
            className="mt-8 w-full"
            variant="outline"
          >
            <PlusCircle className="h-4 w-4 mr-2" />
            Neue Frage
          </Button>
        </TabsContent>

        <TabsContent value="preview">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                Quiz Vorschau
              </CardTitle>
            </CardHeader>
            <CardContent>
              {questions.map((question, index) => (
                <div key={question.id} className="mb-8 last:mb-0">
                  <div className="flex items-center gap-3 mb-2">
                    <Badge variant="outline" className="font-normal">
                      {QUESTION_TYPES.find(t => t.value === question.type)?.label}
                    </Badge>
                  </div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-3">
                    <span className="bg-primary text-primary-foreground rounded-full w-8 h-8 flex items-center justify-center text-sm">
                      {index + 1}
                    </span>
                    {question.question}
                  </h3>
                  {question.type === 'TEXT_INPUT' && (
                    <div className="p-4 rounded-lg border transition-colors flex items-center gap-3">
                      <Input
                        value={question.correctAnswer}
                        readOnly
                        className="w-full"
                      />
                    </div>
                  )}
                  {question.type === 'MATCHING' && (
                    <div className="space-y-3">
                      {question.pairs.map((pair, pairIndex) => (
                        <div key={pairIndex} className="flex items-center gap-3">
                          <div className="bg-muted rounded-full px-2 py-1 text-sm font-medium text-muted-foreground">
                            {String.fromCharCode(65 + pairIndex)}
                          </div>
                          <div className="flex-1">{pair.left}</div>
                          <div className="flex-1">{pair.right}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {question.type === 'FILL_BLANKS' && (
                    <div className="space-y-3">
                      <p className="text-lg font-normal">{question.text}</p>
                      {question.answers.map((answer, answerIndex) => (
                        <div key={answerIndex} className="flex items-center gap-3">
                          <div className="bg-muted rounded-full px-2 py-1 text-sm font-medium text-muted-foreground">
                            {String.fromCharCode(65 + answerIndex)}
                          </div>
                          <div className="flex-1">{answer}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {(question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE') && (
                    <div className="space-y-3">
                      {question.options.map((option, optIndex) => (
                        <div
                          key={optIndex}
                          className={cn(
                            "p-4 rounded-lg border transition-colors flex items-center gap-3",
                            isCorrectAnswer(index, optIndex)
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-border"
                          )}
                        >
                          <div className="bg-muted rounded-full px-2 py-1 text-sm font-medium text-muted-foreground">
                            {String.fromCharCode(65 + optIndex)}
                          </div>
                          <div className="flex-1">{option}</div>
                          {isCorrectAnswer(index, optIndex) && (
                            <Badge variant="outline">Richtig</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {question.explanation && (
                    <Alert className="mt-4">
                      <AlertDescription>{question.explanation}</AlertDescription>
                    </Alert>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
      {showSaveButton && <Button type="button" onClick={handleSave} disabled={disabled || isSaving}>{isSaving ? 'Quiz wird gespeichert…' : 'Quiz speichern'}</Button>}
    </fieldset>
  );
}
