'use client';

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useState, useRef, useEffect, useEffectEvent, useId, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { PlusCircle, Trash2, GripVertical, Eye, ArrowUpDown, ArrowUp, ArrowDown, CheckSquare, Square, Copy } from 'lucide-react';
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createQuizQuestion as createEmptyQuestion, duplicateQuizQuestion, getQuizAuthoringReadiness, QUIZ_QUESTION_TYPES as QUESTION_TYPES, quizQuestionTypeLabel } from './quiz-authoring';
import { QuizAuthorPreview } from './QuizAuthorPreview';
import { QuestionBankPanel } from './QuestionBankPanel';

interface QuizEditorProps {
  initialContent?: QuizContent | string;
  onSave: (content: QuizContent) => void | Promise<void>;
  onChange?: (content: QuizContent) => void;
  showSaveButton?: boolean;
  disabled?: boolean;
}

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
  const lastNotifiedDraft = useRef(JSON.stringify(draft()));
  const notifyChange = useEffectEvent(() => {
    const value = draft(), signature = JSON.stringify(value);
    if (initialQuiz && signature !== lastNotifiedDraft.current) {
      lastNotifiedDraft.current = signature;
      onChange?.(value);
    }
  });
  useEffect(() => { notifyChange(); }, [questions, shuffleQuestions, passingScore]);
  const [draggedQuestionIndex, setDraggedQuestionIndex] = useState<number | null>(null);
  const [dragOverQuestionIndex, setDragOverQuestionIndex] = useState<number | null>(null);
  const [newQuestionType, setNewQuestionType] = useState<QuestionType>('SINGLE_CHOICE');
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(questions[0]?.id ?? null);
  const [statusMessage, setStatusMessage] = useState('');
  const [removedQuestion, setRemovedQuestion] = useState<{ question: QuizQuestion; index: number } | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const readiness = getQuizAuthoringReadiness(draft());

  const focusQuestion = useCallback((id: string) => {
    setActiveQuestionId(id);
    const field = document.getElementById(`${formId}-question-${id}`);
    field?.focus();
    field?.scrollIntoView?.({ block: 'nearest' });
  }, [formId]);
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    if (id === '__add-question__') document.getElementById(`${formId}-add-question`)?.focus();
    else focusQuestion(id);
  }, [questions, formId, focusQuestion]);

  const moveQuestion = (fromIndex: number, toIndex: number) => {
    if (disabled || isSaving) return;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= questions.length || toIndex >= questions.length) return;
    const newQuestions = [...questions];
    const [movedQuestion] = newQuestions.splice(fromIndex, 1);
    newQuestions.splice(toIndex, 0, movedQuestion);
    setQuestions(newQuestions);
    setStatusMessage(`Frage ${fromIndex + 1} auf Position ${toIndex + 1} verschoben.`);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (disabled || isSaving) { e.preventDefault(); return; }
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
    const question = createEmptyQuestion(newQuestionType);
    pendingFocus.current = question.id;
    setQuestions([...questions, question]);
    setStatusMessage(`Frage ${questions.length + 1} angelegt: ${quizQuestionTypeLabel(newQuestionType)}.`);
  };

  const removeQuestion = (index: number) => {
    setRemovedQuestion({ question: questions[index], index });
    pendingFocus.current = questions[index + 1]?.id ?? questions[index - 1]?.id ?? '__add-question__';
    setQuestions(questions.filter((_, i) => i !== index));
    setStatusMessage(`Frage ${index + 1} aus dem lokalen Entwurf entfernt.`);
  };

  const restoreQuestion = () => {
    if (!removedQuestion) return;
    const next = [...questions];
    next.splice(Math.min(removedQuestion.index, next.length), 0, removedQuestion.question);
    pendingFocus.current = removedQuestion.question.id;
    setQuestions(next);
    setRemovedQuestion(null);
    setStatusMessage('Die entfernte Frage wurde im Entwurf wiederhergestellt.');
  };

  const duplicateQuestion = (index: number) => {
    const copy = duplicateQuizQuestion(questions[index], questions.map(question => question.id));
    const next = [...questions];
    next.splice(index + 1, 0, copy);
    pendingFocus.current = copy.id;
    setQuestions(next);
    setStatusMessage(`Frage ${index + 1} als Frage ${index + 2} dupliziert.`);
  };

  const insertBankQuestion = (source: QuizQuestion) => {
    // A bank revision is read only by its owner. The quiz persists a complete,
    // independent question snapshot with a fresh local ID, never a bank link.
    const copy = duplicateQuizQuestion(source, questions.map(question => question.id));
    pendingFocus.current = copy.id;
    setQuestions(previous => [...previous, copy]);
    setStatusMessage(`Pool-Frage als Frage ${questions.length + 1} eingefügt.`);
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
      <legend className="sr-only">Quiz bearbeiten</legend>
      <Tabs defaultValue="edit" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="edit">Bearbeiten</TabsTrigger>
          <TabsTrigger value="preview">Vorschau</TabsTrigger>
        </TabsList>

        <TabsContent value="edit">
          <section className="mb-6 space-y-3 border-b pb-5" aria-label="Quizprüfung">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-lg font-semibold">Quiz aufbauen</h3><p className="text-sm text-muted-foreground">{questions.length} {questions.length === 1 ? 'Frage' : 'Fragen'}</p></div>
            <p className="text-sm leading-relaxed text-muted-foreground">Formuliere Fragen, markiere die Lösungen und prüfe deinen Entwurf in der Vorschau. Gespeicherte Änderungen bleiben privat, bis du den Kurs ausdrücklich veröffentlichst.</p>
            <p className="text-sm">Jede Frage zählt gleich viel. Eine mehrteilige Antwort zählt nur, wenn alle Teile richtig sind.</p>
            {readiness.requiredCorrectCount !== null && <p className="text-sm font-medium">Zum Bestehen nötig: {readiness.requiredCorrectCount} von {questions.length} Fragen richtig.</p>}
            {Number(passingScore) === 0 && passingScore.trim() && <p className="text-sm text-muted-foreground">Bei 0% Bestehensgrenze kann eine vollständige Abgabe auch ohne richtige Antwort bestehen.</p>}
            {readiness.issues.length ? <div className="space-y-2 rounded-lg border border-input p-3">
              <p className="text-sm font-medium">{readiness.issues.length} {readiness.issues.length === 1 ? 'Punkt' : 'Punkte'} prüfen</p>
              <ul className="space-y-2 text-sm">{readiness.issues.map(issue => <li key={issue.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 basis-40 break-words [overflow-wrap:anywhere]">{issue.message}</span>
                {issue.questionId && <Button type="button" size="sm" variant="ghost" aria-label={issue.message} onClick={() => focusQuestion(issue.questionId!)}>Frage prüfen</Button>}
              </li>)}</ul>
            </div> : <p className="text-sm text-muted-foreground">Alle Fragen sind vollständig ausgefüllt.</p>}
          </section>
          {questions.length > 0 && <nav aria-label="Fragenübersicht" className="mb-6 space-y-2"><h3 className="text-sm font-semibold">Fragenübersicht</h3><ol className="max-h-64 divide-y overflow-y-auto rounded-lg border">{questions.map((question, index) => {
            const hasIssue = readiness.issues.some(issue => issue.questionId === question.id);
            return <li key={question.id}><button type="button" aria-label={`Zu Frage ${index + 1}: ${question.question || 'Fragetext fehlt'}`} aria-current={activeQuestionId === question.id ? 'true' : undefined} className={cn('flex min-h-11 w-full min-w-0 items-start gap-3 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent', activeQuestionId === question.id && 'bg-muted')} onClick={() => focusQuestion(question.id)}><span className="shrink-0 tabular-nums">{index + 1}.</span><span className="min-w-0 flex-1"><span className="block truncate font-medium">{question.question || 'Fragetext fehlt'}</span><span className="block text-muted-foreground">{quizQuestionTypeLabel(question.type)} · {hasIssue ? 'Prüfen' : 'Vollständig'}</span></span></button></li>;
          })}</ol></nav>}
          <Card className="mb-6 rounded-none border-0 border-b bg-transparent shadow-none">
            <CardHeader className="px-0 pt-0">
              <CardTitle className="flex items-center gap-2">
                <ArrowUpDown className="h-5 w-5" />
                Quiz Einstellungen
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-0">
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

          <div className="mb-6 flex min-w-0 flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 basis-44 space-y-2"><Label htmlFor={`${formId}-new-type`}>Neue Frage als</Label><select id={`${formId}-new-type`} value={newQuestionType} onChange={event => setNewQuestionType(event.target.value as QuestionType)} className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{QUESTION_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></div>
            <Button id={`${formId}-add-question`} type="button" onClick={addQuestion} variant="outline" className="min-h-11"><PlusCircle className="mr-2 h-4 w-4" />Neue Frage</Button>
          </div>
          <QuestionBankPanel activeQuestion={questions.find(question => question.id === activeQuestionId) ?? null} onInsert={insertBankQuestion} />
          <p role="status" className="sr-only">{statusMessage}</p>
          {removedQuestion && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3 text-sm"><span>Frage aus dem Entwurf entfernt.</span><Button type="button" variant="ghost" size="sm" onClick={restoreQuestion}>Rückgängig</Button></div>}
          <div className="space-y-6">
            {questions.map((question, questionIndex) => (
              <Card
                key={question.id}
                className={cn(
                  "relative rounded-none border-0 border-t bg-transparent shadow-none",
                  draggedQuestionIndex === questionIndex && "opacity-50",
                  draggedQuestionIndex !== null && dragOverQuestionIndex === questionIndex && "border-primary border-dashed"
                )}
                onDragOver={(e) => handleDragOver(e, questionIndex)}
                onDrop={(e) => handleDrop(e, questionIndex)}
                onDragEnd={handleDragEnd}
                onFocusCapture={() => setActiveQuestionId(question.id)}
              >
                <div className="flex flex-wrap justify-end gap-1 pt-4">
                  <Button type="button" variant="ghost" size="icon" aria-label={`Frage ${questionIndex + 1} duplizieren`} onClick={() => duplicateQuestion(questionIndex)}><Copy className="h-4 w-4" /></Button>
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
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <CardHeader className="cursor-move select-none px-0" draggable={!disabled && !isSaving} onDragStart={(event) => handleDragStart(event, questionIndex)}>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-1">
                      <GripVertical className="h-5 w-5 text-muted-foreground" />
                      <CardTitle>Frage {questionIndex + 1}</CardTitle>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-6 px-0">
                  <div className="space-y-2">
                    <Label htmlFor={`${formId}-question-${question.id}`} className="text-base font-medium">Frage</Label>
                    <Textarea
                      id={`${formId}-question-${question.id}`}
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
                      <p className="text-sm text-muted-foreground">Die rechten Begriffe werden von Lernenden als Text eingegeben. Groß- und Kleinschreibung wird nicht beachtet.</p>
                      {question.pairs.map((pair, pairIndex) => (
                        <div key={pairIndex} className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3">
                          <Input
                            aria-label={`Frage ${questionIndex + 1}, Paar ${pairIndex + 1}, linker Teil`}
                            value={pair.left}
                            onChange={(e) => updateMatchingPair(questionIndex, pairIndex, 'left', e.target.value)}
                            placeholder="Linker Teil"
                            className="min-w-0 flex-1"
                          />
                          <Input
                            aria-label={`Frage ${questionIndex + 1}, Paar ${pairIndex + 1}, rechter Teil`}
                            value={pair.right}
                            onChange={(e) => updateMatchingPair(questionIndex, pairIndex, 'right', e.target.value)}
                            placeholder="Rechter Teil"
                            className="min-w-0 flex-1"
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
                      <p className="text-sm text-muted-foreground">Diese Kurzantwort wird automatisch mit dem hinterlegten Text verglichen. Leerzeichen am Anfang und Ende werden ignoriert.</p>
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
                          id={`${formId}-case-sensitive-${question.id}`}
                          checked={question.caseSensitive}
                          onCheckedChange={(checked) =>
                            updateQuestion(questionIndex, 'caseSensitive', checked)
                          }
                        />
                        <Label htmlFor={`${formId}-case-sensitive-${question.id}`}>
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
                      <p className="text-sm text-muted-foreground">Die Antworten werden in der Reihenfolge der Eingabefelder geprüft. Markierungen im Text werden unverändert angezeigt.</p>
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
                            className="min-w-0 flex-1"
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
                                "min-w-0 flex-1",
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

        </TabsContent>

        <TabsContent value="preview">
          <Card className="rounded-none border-0 bg-transparent shadow-none">
            <CardHeader className="px-0">
              <CardTitle className="flex items-center gap-2"><Eye className="h-5 w-5" />Quiz Vorschau</CardTitle>
            </CardHeader>
            <CardContent className="px-0"><QuizAuthorPreview content={draft()} disabled={disabled || isSaving} /></CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
      {showSaveButton && <Button type="button" onClick={handleSave} disabled={disabled || isSaving}>{isSaving ? 'Quiz wird gespeichert…' : 'Quiz speichern'}</Button>}
    </fieldset>
  );
}
