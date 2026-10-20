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
import { PlusCircle, Trash2, GripVertical, Eye, ArrowUp, ArrowDown, CheckSquare, Square, Copy } from 'lucide-react';
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
import styles from './QuizStage.module.css';
import { getPendingQuizOptionImageReadiness, parseCanonicalQuizOptionAssetUrl, parseQuizOptionImages, type PendingQuizOptionImage } from '@/lib/quiz-media-contract';
import { appendQuizOption, removeQuizOption, moveQuizOption, replaceQuizOptionCaption, replaceQuizOptionImage, removeQuizOptionImage, type QuizOptionImageState, type QuizOptionImageStateResult } from '@/lib/quiz-option-image-state';
import { prepareCourseOptionImage } from '@/lib/course-option-image-prepare';

interface QuizEditorProps {
  initialContent?: QuizContent | string;
  courseId?: string;
  onImageUpload?: (file: File, signal?: AbortSignal) => Promise<string>;
  onImageStateChange?: (blocked: boolean) => void;
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

export function QuizEditor({ initialContent, courseId, onImageUpload, onImageStateChange, onSave, onChange, showSaveButton = true, disabled = false }: QuizEditorProps) {
  const [initialQuiz] = useState(() => initialContent === undefined ? { questions: [], shuffleQuestions: false, passingScore: 70 } as QuizContent : quizEditorDraft(initialContent, courseId));
  const [questions, setQuestionsState] = useState<QuizQuestion[]>(initialQuiz?.questions ?? []);
  const questionsRef = useRef(questions);
  questionsRef.current = questions;
  const setQuestions = (update: React.SetStateAction<QuizQuestion[]>) => setQuestionsState(previous => {
    const next = typeof update === 'function' ? update(previous) : update;
    questionsRef.current = next;
    return next;
  });
  const [shuffleQuestions, setShuffleQuestions] = useState(initialQuiz?.shuffleQuestions ?? false);
  const [passingScore, setPassingScore] = useState(() => Number.isFinite(initialQuiz?.passingScore ?? 70) ? String(initialQuiz?.passingScore ?? 70) : '');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const questionTypesRef = useRef(new Map<string, QuizQuestion>());
  const inputBlockedRef = useRef(disabled || isSaving);
  inputBlockedRef.current = disabled || isSaving;
  const editorMounted = useRef(true);
  useEffect(() => { editorMounted.current = true; return () => { editorMounted.current = false; }; }, []);
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
  const baseReadiness = getQuizAuthoringReadiness(draft(), undefined, courseId);
  const slotIds = useRef(new Map<string, string[]>());
  const attachmentGeneration = useRef(0);
  type Attachment = { questionId: string; slotId: string; generation: number; details: PendingQuizOptionImage; controller: AbortController; previewUrl?: string; error?: string };
  const attachments = useRef(new Map<string, Attachment>());
  const [mediaRevision, setMediaRevision] = useState(0);
  const mediaChanged = () => setMediaRevision(value => value + 1);
  const slotsFor = (question: ChoiceQuizQuestion): string[] => {
    let slots = slotIds.current.get(question.id);
    if (!slots || slots.length !== question.options.length) {
      slots = question.options.map(() => globalThis.crypto?.randomUUID?.() ?? `slot-${++attachmentGeneration.current}-${Date.now()}`);
      slotIds.current.set(question.id, slots);
    }
    return slots;
  };
  const releaseAttachment = (slotId: string) => {
    const attachment = attachments.current.get(slotId);
    if (!attachment) return;
    attachment.controller.abort();
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    attachments.current.delete(slotId);
  };
  const invalidateQuestionMedia = (questionId: string, resetSlots = false) => {
    for (const [slotId, attachment] of attachments.current) if (attachment.questionId === questionId) releaseAttachment(slotId);
    if (resetSlots) slotIds.current.delete(questionId);
    mediaChanged();
  };
  const currentAttachment = (attachment: Attachment) => attachments.current.get(attachment.slotId)?.generation === attachment.generation;
  const hasPendingMedia = attachments.current.size > 0;
  const invalidPersistedMedia = questions.some(question => 'optionImages' in question && !parseQuizOptionImages(question, courseId ?? '').ok);
  const mediaBlocked = hasPendingMedia || invalidPersistedMedia;
  const pendingFindings = Array.from(attachments.current.values()).map(attachment => ({ id: `pending-image-${attachment.slotId}`, kind: 'question-invalid' as const, severity: 'error' as const, questionId: attachment.questionId, message: `Frage ${questions.findIndex(question => question.id === attachment.questionId) + 1}: Schließe die Bilddetails ab oder entferne den unfertigen Bildanhang.` }));
  const readiness = hasPendingMedia ? { ...baseReadiness, ready: false, issues: [...baseReadiness.issues, ...pendingFindings] } : baseReadiness;
  const imageStateCallback = useRef(onImageStateChange);
  imageStateCallback.current = onImageStateChange;
  useEffect(() => { imageStateCallback.current?.(mediaBlocked); }, [mediaBlocked]);
  useEffect(() => () => {
    for (const attachment of attachments.current.values()) {
      attachment.controller.abort();
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
    attachments.current.clear();
    imageStateCallback.current?.(false);
  }, []);
  // Read the mutable attachment registry only through a render revision. It is
  // local-only and never reaches onChange, persistence or learner projection.
  void mediaRevision;
  const choiceState = (question: ChoiceQuizQuestion): QuizOptionImageState => ({ options: question.options, correctAnswers: question.correctAnswers, ...(question.optionImages && { optionImages: question.optionImages }) });
  const applyChoiceState = (question: ChoiceQuizQuestion, result: QuizOptionImageStateResult): ChoiceQuizQuestion => {
    if (!result.ok) return question;
    const { optionImages: _previousImages, ...rest } = question;
    return { ...rest, options: [...result.value.options], correctAnswers: [...result.value.correctAnswers], ...(result.value.optionImages && { optionImages: result.value.optionImages }) };
  };
  const commitReadyAttachment = (attachment: Attachment) => {
    if (!courseId || !currentAttachment(attachment)) return;
    const readiness = getPendingQuizOptionImageReadiness(attachment.details, courseId);
    if (!readiness.ready) { mediaChanged(); return; }
    const liveQuestion = questionsRef.current.find(item => item.id === attachment.questionId);
    const index = slotIds.current.get(attachment.questionId)?.indexOf(attachment.slotId) ?? -1;
    if (!liveQuestion || !isChoiceQuestion(liveQuestion) || liveQuestion.type === 'TRUE_FALSE' || index < 0) return;
    setQuestions(previous => previous.map(question => question.id === attachment.questionId && isChoiceQuestion(question) && question.type !== 'TRUE_FALSE'
      ? applyChoiceState(question, replaceQuizOptionImage(choiceState(question), index, readiness.image)) : question));
    releaseAttachment(attachment.slotId);
    mediaChanged();
  };
  const startImageUpload = async (questionId: string, optionIndex: number, file: File) => {
    const question = questionsRef.current.find(item => item.id === questionId);
    if (!question || !isChoiceQuestion(question) || question.type === 'TRUE_FALSE' || !courseId || !onImageUpload || disabled || isSaving) return;
    const slotId = slotsFor(question)[optionIndex];
    if (!slotId) return;
    releaseAttachment(slotId);
    const attachment: Attachment = { questionId, slotId, generation: ++attachmentGeneration.current, controller: new AbortController(), details: { kind: 'LOCAL_PENDING_IMAGE', upload: { status: 'PENDING' }, alt: '', rights: { basis: null } } };
    attachments.current.set(slotId, attachment);
    mediaChanged();
    try {
      const prepared = await prepareCourseOptionImage(file);
      if (!currentAttachment(attachment)) return;
      attachment.previewUrl = URL.createObjectURL(prepared);
      mediaChanged();
      const src = await onImageUpload(prepared, attachment.controller.signal);
      if (!currentAttachment(attachment)) return;
      const canonical = parseCanonicalQuizOptionAssetUrl(src, courseId);
      if (!canonical.ok) throw new Error('Die Upload-Antwort gehört nicht zu diesem Kurs. Das Bild wurde nicht angehängt.');
      attachment.details = { ...attachment.details, upload: { status: 'UPLOADED', src: canonical.value.src } };
      if (attachment.previewUrl) { URL.revokeObjectURL(attachment.previewUrl); delete attachment.previewUrl; }
      commitReadyAttachment(attachment);
    } catch (failure) {
      if (!currentAttachment(attachment)) return;
      attachment.details = { ...attachment.details, upload: { status: 'FAILED' } };
      attachment.error = failure instanceof Error ? failure.message : 'Der Upload wurde nicht abgeschlossen. Es wurde kein Bild angehängt.';
      mediaChanged();
    }
  };
  const updateImageDetails = (question: ChoiceQuizQuestion, optionIndex: number, field: 'alt' | 'basis' | 'attribution' | 'sourceUrl' | 'licenseLabel', value: string) => {
    if (inputBlockedRef.current || !editorMounted.current) return;
    const slotId = slotsFor(question)[optionIndex];
    let attachment = attachments.current.get(slotId);
    const image = question.optionImages?.[optionIndex];
    if (!attachment && image) {
      attachment = { questionId: question.id, slotId, generation: ++attachmentGeneration.current, controller: new AbortController(), details: { kind: 'LOCAL_PENDING_IMAGE', upload: { status: 'UPLOADED', src: image.src }, alt: image.alt, rights: { ...image.rights } } };
      attachments.current.set(slotId, attachment);
    }
    if (!attachment) return;
    if (field === 'alt') attachment.details = { ...attachment.details, alt: value };
    else {
      const rights = { ...attachment.details.rights };
      if (field === 'basis') rights.basis = value === 'OWN' || value === 'PERMISSION_OR_LICENSE' ? value : null;
      else if (value) rights[field] = value;
      else delete rights[field];
      attachment.details = { ...attachment.details, rights };
    }
    commitReadyAttachment(attachment);
  };
  const imageDetailMessage = (details: PendingQuizOptionImage): string | null => {
    const result = getPendingQuizOptionImageReadiness(details, courseId ?? '');
    if (result.ready) return null;
    const messages: Partial<Record<typeof result.error.code, string>> = {
      UPLOAD_PENDING: 'Bild wird vorbereitet und privat hochgeladen…', UPLOAD_FAILED: 'Upload nicht abgeschlossen. Wähle die Datei erneut oder entferne den Anhang.',
      INVALID_ALT: 'Beschreibe die für diese Aufgabe wichtigen Bildinformationen (max. 300 Zeichen).', INVALID_RIGHTS: 'Wähle die Grundlage für deine Bildrechte.',
      INVALID_ATTRIBUTION: 'Gib den erforderlichen Bildnachweis an (max. 300 Zeichen).', INVALID_LICENSE_LABEL: 'Gib die Lizenz oder erteilte Erlaubnis an (max. 120 Zeichen).',
      INVALID_SOURCE_URL: 'Die Quelle muss eine öffentliche HTTPS-Adresse ohne Anmeldung, Abfrage oder Anker sein.',
    };
    return messages[result.error.code] ?? 'Prüfe die Bilddetails. Der unfertige Anhang wird noch nicht gespeichert.';
  };

  const selectedQuestionId = questions.some(question => question.id === activeQuestionId) ? activeQuestionId : questions[0]?.id ?? null;
  const focusQuestion = useCallback((id: string) => {
    // Select first. The requested question's field is mounted only after this commit.
    pendingFocus.current = id;
    setActiveQuestionId(id);
    const field = document.getElementById(`${formId}-question-${id}`);
    if (field) {
      pendingFocus.current = null;
      field.focus();
      field.scrollIntoView?.({ block: 'nearest' });
    }
  }, [formId]);
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    if (id === '__add-question__') {
      pendingFocus.current = null;
      document.getElementById(`${formId}-add-question`)?.focus();
      return;
    }
    if (selectedQuestionId !== id) {
      setActiveQuestionId(id);
      return;
    }
    const field = document.getElementById(`${formId}-question-${id}`);
    if (!field) return;
    pendingFocus.current = null;
    field.focus();
    field.scrollIntoView?.({ block: 'nearest' });
  }, [questions, selectedQuestionId, activeQuestionId, formId]);

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
    if (inputBlockedRef.current || !editorMounted.current) return;
    const question = createEmptyQuestion(newQuestionType);
    pendingFocus.current = question.id;
    setQuestions([...questions, question]);
    setStatusMessage(`Frage ${questions.length + 1} angelegt: ${quizQuestionTypeLabel(newQuestionType)}.`);
  };

  const removeQuestion = (index: number) => {
    if (inputBlockedRef.current || !editorMounted.current) return;
    invalidateQuestionMedia(questions[index].id, true);
    setRemovedQuestion({ question: questions[index], index });
    pendingFocus.current = questions[index + 1]?.id ?? questions[index - 1]?.id ?? '__add-question__';
    setQuestions(questions.filter((_, i) => i !== index));
    setStatusMessage(`Frage ${index + 1} aus dem lokalen Entwurf entfernt.`);
  };

  const restoreQuestion = () => {
    if (inputBlockedRef.current || !editorMounted.current) return;
    if (!removedQuestion) return;
    invalidateQuestionMedia(removedQuestion.question.id, true);
    const next = [...questions];
    next.splice(Math.min(removedQuestion.index, next.length), 0, removedQuestion.question);
    pendingFocus.current = removedQuestion.question.id;
    setQuestions(next);
    setRemovedQuestion(null);
    setStatusMessage('Die entfernte Frage wurde im Entwurf wiederhergestellt.');
  };

  const duplicateQuestion = (index: number) => {
    if (inputBlockedRef.current || !editorMounted.current) return;
    const copy = duplicateQuizQuestion(questions[index], questions.map(question => question.id));
    const next = [...questions];
    next.splice(index + 1, 0, copy);
    pendingFocus.current = copy.id;
    setQuestions(next);
    setStatusMessage(`Frage ${index + 1} als Frage ${index + 2} dupliziert.`);
  };

  const insertBankQuestion = (source: QuizQuestion) => {
    // A pending pool read may finish after the enclosing save disabled us.
    if (inputBlockedRef.current || !editorMounted.current) return false;
    if ('optionImages' in source) { setValidationError('Bildfragen aus dem Pool können nicht kursübergreifend eingefügt werden. Dupliziere Bildfragen nur innerhalb dieses Kurses.'); return false; }
    // A bank revision is read only by its owner. The quiz persists a complete,
    // independent question snapshot with a fresh local ID, never a bank link.
    const copy = duplicateQuizQuestion(source, questions.map(question => question.id));
    pendingFocus.current = copy.id;
    setQuestions(previous => [...previous, copy]);
    setStatusMessage(`Pool-Frage als Frage ${questions.length + 1} eingefügt.`);
    return true;
  };

  const updateQuestion = (questionIndex: number, field: string, value: any) => {
    if (inputBlockedRef.current || !editorMounted.current) return;
    if (field === 'type' && questions[questionIndex]?.type !== value) invalidateQuestionMedia(questions[questionIndex].id, true);
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
    if (inputBlockedRef.current || !editorMounted.current) return;
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
    if (inputBlockedRef.current || !editorMounted.current) return;
    const question = questions[questionIndex];
    if (!question || !isChoiceQuestion(question) || question.type === 'TRUE_FALSE' || question.options.length >= 6) return;
    slotsFor(question).push(globalThis.crypto?.randomUUID?.() ?? `slot-${++attachmentGeneration.current}`);
    setQuestions(previous => previous.map(item => item.id === question.id && isChoiceQuestion(item) ? applyChoiceState(item, appendQuizOption(choiceState(item))) : item));
  };

  const removeOption = (questionIndex: number, optionIndex: number) => {
    if (inputBlockedRef.current || !editorMounted.current) return;
    const question = questions[questionIndex];
    if (!question || !isChoiceQuestion(question) || question.type === 'TRUE_FALSE' || question.options.length <= 2) return;
    // Invalidate first, before React commits shifted indexes. Abort alone is not
    // sufficient: deleting each generation makes a late completion harmless.
    invalidateQuestionMedia(question.id);
    slotsFor(question).splice(optionIndex, 1);
    setQuestions(previous => previous.map(item => item.id === question.id && isChoiceQuestion(item) ? applyChoiceState(item, removeQuizOption(choiceState(item), optionIndex)) : item));
  };

  const moveOption = (questionIndex: number, fromIndex: number, toIndex: number) => {
    if (inputBlockedRef.current || !editorMounted.current) return;
    const question = questions[questionIndex];
    if (!question || !isChoiceQuestion(question) || question.type === 'TRUE_FALSE' || toIndex < 0 || toIndex >= question.options.length) return;
    invalidateQuestionMedia(question.id);
    const slots = slotsFor(question);
    const [slot] = slots.splice(fromIndex, 1);
    slots.splice(toIndex, 0, slot);
    setQuestions(previous => previous.map(item => item.id === question.id && isChoiceQuestion(item) ? applyChoiceState(item, moveQuizOption(choiceState(item), fromIndex, toIndex)) : item));
  };

  const updateOption = (questionIndex: number, optionIndex: number, value: string) => {
    if (inputBlockedRef.current || !editorMounted.current) return;
    setQuestions(previous => previous.map((question, index) => index === questionIndex && isChoiceQuestion(question)
      ? applyChoiceState(question, replaceQuizOptionCaption(choiceState(question), optionIndex, value)) : question));
  };

  const removeImage = (question: ChoiceQuizQuestion, optionIndex: number) => {
    if (inputBlockedRef.current || !editorMounted.current) return;
    releaseAttachment(slotsFor(question)[optionIndex]);
    setQuestions(previous => previous.map(item => item.id === question.id && isChoiceQuestion(item) ? applyChoiceState(item, removeQuizOptionImage(choiceState(item), optionIndex)) : item));
    mediaChanged();
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
    const error = mediaBlocked ? 'Schließe die Bilddetails ab oder entferne den unfertigen Bildanhang.' : getQuizValidationError(content, courseId);
    setValidationError(error);
    if (error) return;
    setIsSaving(true);
    try { await onSave(content); }
    catch (error) { setValidationError(error instanceof Error ? error.message : 'Das Quiz konnte nicht gespeichert werden.'); }
    finally { setIsSaving(false); }
  };

  const updateMatchingPair = (questionIndex: number, pairIndex: number, side: 'left' | 'right', value: string) => {
    if (inputBlockedRef.current || !editorMounted.current) return;
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
    if (inputBlockedRef.current || !editorMounted.current) return;
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isMatchingQuestion(q)) return q;
      return {
        ...q,
        pairs: [...q.pairs, { left: '', right: '' }]
      };
    }));
  };

  const removeMatchingPair = (questionIndex: number, pairIndex: number) => {
    if (inputBlockedRef.current || !editorMounted.current) return;
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isMatchingQuestion(q)) return q;
      return {
        ...q,
        pairs: q.pairs.filter((_, index) => index !== pairIndex)
      };
    }));
  };

  const updateTextInputAnswer = (questionIndex: number, value: string) => {
    if (inputBlockedRef.current || !editorMounted.current) return;
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isTextInputQuestion(q)) return q;
      return {
        ...q,
        correctAnswer: value
      };
    }));
  };

  const updateFillBlanksAnswer = (questionIndex: number, answerIndex: number, value: string) => {
    if (inputBlockedRef.current || !editorMounted.current) return;
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
    if (inputBlockedRef.current || !editorMounted.current) return;
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isFillBlanksQuestion(q)) return q;
      return {
        ...q,
        answers: [...q.answers, '']
      };
    }));
  };

  const removeFillBlanksAnswer = (questionIndex: number, answerIndex: number) => {
    if (inputBlockedRef.current || !editorMounted.current) return;
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
    <fieldset disabled={disabled || isSaving} className={`${styles.builder} min-w-0 space-y-4`}>
      <legend className="sr-only">Quiz bearbeiten</legend>
      <Tabs defaultValue="edit" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="edit">Aufbauen</TabsTrigger>
          <TabsTrigger value="preview">Durchspielen</TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="min-w-0">
          <header className={styles.builderHeader}>
            <h3 className="text-lg font-bold">Quiz aufbauen</h3>
            <p className="text-sm text-muted-foreground">{questions.length} {questions.length === 1 ? 'Frage' : 'Fragen'} · privater Entwurf</p>
          </header>
          <div className={styles.addQuestion}>
            <div className="min-w-0 flex-1 basis-44 space-y-2"><Label htmlFor={`${formId}-new-type`}>Fragetyp hinzufügen</Label><select id={`${formId}-new-type`} value={newQuestionType} onChange={event => setNewQuestionType(event.target.value as QuestionType)} className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">{QUESTION_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></div>
            <Button id={`${formId}-add-question`} type="button" onClick={addQuestion} variant="outline" className="min-h-11"><PlusCircle className="mr-2 h-4 w-4" />Neue Frage</Button>
          </div>
          <p role="status" className="sr-only">{statusMessage}</p>
          {removedQuestion && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3 text-sm"><span>Frage aus dem Entwurf entfernt.</span><Button type="button" variant="ghost" size="sm" onClick={restoreQuestion}>Rückgängig</Button></div>}
          <div className={styles.workspace}>
            {questions.length > 0 && <nav aria-label="Fragenübersicht" className={styles.rail}>
              <h4 className="mb-2 text-sm font-semibold">Deine Fragen</h4>
              <ol className={styles.railList}>{questions.map((question, index) => {
                const hasIssue = readiness.issues.some(issue => issue.questionId === question.id);
                return <li key={question.id} className={cn(styles.railItem, selectedQuestionId === question.id && styles.railItemActive, draggedQuestionIndex === index && 'opacity-50', draggedQuestionIndex !== null && dragOverQuestionIndex === index && 'border-dashed border-primary')} draggable={!disabled && !isSaving} onDragStart={event => handleDragStart(event, index)} onDragOver={event => handleDragOver(event, index)} onDrop={event => handleDrop(event, index)} onDragEnd={handleDragEnd}>
                  <button type="button" aria-label={`Frage ${index + 1} bearbeiten: ${question.question || 'Fragetext fehlt'}`} aria-current={selectedQuestionId === question.id ? 'step' : undefined} className={styles.railButton} onClick={() => focusQuestion(question.id)}>
                    <span className={styles.railOrder}>{index + 1}</span>
                    <span className={styles.railCopy}><span className={styles.railTitle}>{question.question || 'Fragetext fehlt'}</span><span className={styles.railMeta}>{quizQuestionTypeLabel(question.type)} · {hasIssue ? 'Prüfen' : 'Vollständig'}</span></span>
                  </button>
                  <div className={styles.railMove}>
                    <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={index === 0} aria-label={`Frage ${index + 1} nach oben verschieben`} onClick={() => moveQuestionUp(index)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" disabled={index === questions.length - 1} aria-label={`Frage ${index + 1} nach unten verschieben`} onClick={() => moveQuestionDown(index)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                  </div>
                </li>;
              })}</ol>
            </nav>}
          <div className={styles.editorPane}>
            {questions.map((question, questionIndex) => question.id === selectedQuestionId ? (
              <Card
                key={question.id}
                className={cn(
                  styles.editorCard,
                  draggedQuestionIndex === questionIndex && "opacity-50",
                  draggedQuestionIndex !== null && dragOverQuestionIndex === questionIndex && "border-primary border-dashed"
                )}
                onDragOver={(e) => handleDragOver(e, questionIndex)}
                onDrop={(e) => handleDrop(e, questionIndex)}
                onDragEnd={handleDragEnd}
              >
                <CardHeader className="mb-4 flex-row flex-wrap items-center justify-between gap-2 p-0">
                  <div className="flex cursor-move items-center gap-2" draggable={!disabled && !isSaving} onDragStart={event => handleDragStart(event, questionIndex)}>
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                    <CardTitle>Frage {questionIndex + 1}</CardTitle>
                  </div>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon" aria-label={`Frage ${questionIndex + 1} duplizieren`} onClick={() => duplicateQuestion(questionIndex)}><Copy className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Frage ${questionIndex + 1} löschen`} onClick={() => removeQuestion(questionIndex)} className="text-destructive hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
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
                      disabled={disabled || isSaving}
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
                      {question.options.map((option, optionIndex) => {
                        const slotId = slotsFor(question)[optionIndex];
                        const attachment = attachments.current.get(slotId);
                        const image = question.optionImages?.[optionIndex];
                        const details: PendingQuizOptionImage | null = attachment?.details ?? (image ? { kind: 'LOCAL_PENDING_IMAGE', upload: { status: 'UPLOADED', src: image.src }, alt: image.alt, rights: { ...image.rights } } : null);
                        const imageSrc = attachment?.previewUrl ?? (details?.upload.status === 'UPLOADED' ? details.upload.src : image?.src);
                        return <div key={slotId} className={styles.imageEditorCard}>
                          <div className={styles.optionEditor}>
                            <div className="bg-muted rounded-full px-2 py-1 text-sm font-medium text-muted-foreground">
                              {String.fromCharCode(65 + optionIndex)}
                            </div>
                            <Input
                              aria-label={`Frage ${questionIndex + 1}, Option ${optionIndex + 1}`}
                              value={option}
                              onChange={(e) => updateOption(questionIndex, optionIndex, e.target.value)}
                              placeholder={`Option ${optionIndex + 1}`}
                              className={cn(
                                styles.optionInput,
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
                          {question.type !== 'TRUE_FALSE' && <>
                            <div className={styles.optionMove} aria-label={`Reihenfolge von Option ${optionIndex + 1}`}>
                              <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={optionIndex === 0} aria-label={`Option ${optionIndex + 1} nach oben verschieben`} onClick={() => moveOption(questionIndex, optionIndex, optionIndex - 1)}><ArrowUp className="mr-1 h-4 w-4" />Nach oben</Button>
                              <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={optionIndex === question.options.length - 1} aria-label={`Option ${optionIndex + 1} nach unten verschieben`} onClick={() => moveOption(questionIndex, optionIndex, optionIndex + 1)}><ArrowDown className="mr-1 h-4 w-4" />Nach unten</Button>
                            </div>
                            {courseId && onImageUpload && <div className={styles.imageAttachment}>
                              {imageSrc && <div className={styles.authorImageStage}>{/* Authenticated author bytes bypass public optimizers. */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={imageSrc} alt={details?.alt || 'Lokale Bildvorschau, Bildbeschreibung noch ausfüllen'} className={styles.answerImage} referrerPolicy="no-referrer" />
                              </div>}
                              <Label htmlFor={`${formId}-image-${slotId}`} className="block text-sm font-medium">{image || attachment ? 'Anderes Bild wählen' : 'Bild zur Antwort hinzufügen'}</Label>
                              <Input id={`${formId}-image-${slotId}`} className="min-h-11" type="file" accept="image/jpeg,image/png" onChange={event => {
                                const file = event.target.files?.[0];
                                event.target.value = '';
                                if (file) void startImageUpload(question.id, optionIndex, file);
                              }} />
                              <p className="text-xs text-muted-foreground">JPEG oder statisches PNG, höchstens 5 MiB. Wird als privates Kursbild vorbereitet.</p>
                              {details && <details className={styles.imageDetails} open={Boolean(attachment)}>
                                <summary>Bilddetails {attachment ? 'prüfen' : 'bearbeiten'}</summary>
                                <div className="space-y-3">
                                  <div className="space-y-1"><Label htmlFor={`${formId}-alt-${slotId}`}>Bildbeschreibung für diese Aufgabe</Label><Textarea id={`${formId}-alt-${slotId}`} maxLength={300} value={details.alt} onChange={event => updateImageDetails(question, optionIndex, 'alt', event.target.value)} placeholder="Beschreibe die entscheidenden sichtbaren Informationen." className="min-h-24" /></div>
                                  <p className="text-xs text-muted-foreground">Bildbeschreibung, Kurztext und Bildnachweis sind für Lernende sichtbar. Keine Lösungshinweise oder privaten Angaben eintragen.</p>
                                  <div className="space-y-1"><Label htmlFor={`${formId}-rights-${slotId}`}>Bildrechte</Label><select id={`${formId}-rights-${slotId}`} value={details.rights.basis ?? ''} onChange={event => updateImageDetails(question, optionIndex, 'basis', event.target.value)} className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"><option value="">Bitte auswählen</option><option value="OWN">Eigenes Bild, ich habe die erforderlichen Rechte</option><option value="PERMISSION_OR_LICENSE">Erlaubnis oder passende Lizenz liegt vor</option></select></div>
                                  <div className="space-y-1"><Label htmlFor={`${formId}-credit-${slotId}`}>Bildnachweis{details.rights.basis === 'PERMISSION_OR_LICENSE' ? ' (erforderlich)' : ' (optional)'}</Label><Input id={`${formId}-credit-${slotId}`} maxLength={300} value={details.rights.attribution ?? ''} onChange={event => updateImageDetails(question, optionIndex, 'attribution', event.target.value)} /></div>
                                  <div className="space-y-1"><Label htmlFor={`${formId}-license-${slotId}`}>Lizenz oder Erlaubnis{details.rights.basis === 'PERMISSION_OR_LICENSE' ? ' (erforderlich)' : ' (optional)'}</Label><Input id={`${formId}-license-${slotId}`} maxLength={120} value={details.rights.licenseLabel ?? ''} onChange={event => updateImageDetails(question, optionIndex, 'licenseLabel', event.target.value)} /></div>
                                  <div className="space-y-1"><Label htmlFor={`${formId}-source-${slotId}`}>Öffentliche Quellenadresse (optional)</Label><Input id={`${formId}-source-${slotId}`} inputMode="url" maxLength={2048} value={details.rights.sourceUrl ?? ''} onChange={event => updateImageDetails(question, optionIndex, 'sourceUrl', event.target.value)} placeholder="https://…" /></div>
                                  <p className="text-xs text-muted-foreground">Deine Angabe dokumentiert die Rechtebasis, ersetzt aber keine rechtliche Prüfung.</p>
                                </div>
                              </details>}
                              {attachment && <p role={attachment.details.upload.status === 'PENDING' ? 'status' : 'alert'} className="text-sm text-muted-foreground">{attachment.error || imageDetailMessage(attachment.details)}</p>}
                              {(image || attachment) && <div className="flex flex-wrap gap-2">
                                {attachment && image && <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => { releaseAttachment(slotId); mediaChanged(); }}>Bildänderung abbrechen</Button>}
                                <Button type="button" variant="ghost" size="sm" className="min-h-11 text-destructive" onClick={() => removeImage(question, optionIndex)}>{image ? 'Bild entfernen' : 'Unfertigen Anhang entfernen'}</Button>
                              </div>}
                            </div>}
                          </>}
                        </div>;
                      })}
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

                  <details className={styles.disclosure}>
                    <summary>Erklärung (optional)</summary>
                    <Textarea
                      aria-label={`Erklärung für Frage ${questionIndex + 1}`}
                      value={question.explanation ?? ''}
                      onChange={(e) => updateQuestion(questionIndex, 'explanation', e.target.value)}
                      placeholder="Antwort erläutern"
                      className="min-h-[100px] resize-y"
                    />
                  </details>
                </CardContent>
              </Card>
            ) : null)}
          </div>
            <aside className={styles.previewPane} aria-label="Vorschau der aktiven Frage">
              <h4 className={styles.previewHeading}>So sieht deine Frage aus</h4>
              <QuizAuthorPreview courseId={courseId ?? ''} content={draft()} disabled={disabled || isSaving} activeQuestionId={selectedQuestionId} singleQuestion />
            </aside>
          </div>
          {!questions.length && <p className="my-4 text-sm text-muted-foreground">Wähle einen Fragetyp und füge deine erste Frage hinzu.</p>}
          <details className={styles.disclosure}>
            <summary>Fragenpool</summary>
            {questions.some(question => question.id === selectedQuestionId && ('optionImages' in question || Array.from(attachments.current.values()).some(item => item.questionId === question.id))) && <p className="mb-3 text-sm text-muted-foreground">Bildfragen bleiben in diesem Kurs. Du kannst sie hier duplizieren; Speichern und neue Versionen im kursübergreifenden Fragenpool sind für Bildfragen nicht verfügbar.</p>}
            <QuestionBankPanel activeQuestion={questions.find(question => question.id === selectedQuestionId && !('optionImages' in question) && !Array.from(attachments.current.values()).some(item => item.questionId === question.id)) ?? null} onInsert={insertBankQuestion} />
          </details>
          <details className={styles.disclosure}>
            <summary>Quiz-Einstellungen</summary>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4"><Label htmlFor={`${formId}-shuffle`}>Fragen mischen</Label><Switch id={`${formId}-shuffle`} checked={shuffleQuestions} onCheckedChange={setShuffleQuestions} /></div>
              <div className="flex flex-wrap items-center justify-between gap-4"><Label htmlFor={`${formId}-passing-score`}>Bestehensgrenze (%)</Label><Input id={`${formId}-passing-score`} type="number" min="0" max="100" value={passingScore} onChange={event => setPassingScore(event.target.value)} className="w-24" /></div>
              <p className="text-sm text-muted-foreground">Jede Frage zählt gleich viel. Mehrteilige Antworten müssen vollständig richtig sein.</p>
              {readiness.requiredCorrectCount !== null && <p className="text-sm">Zum Bestehen nötig: {readiness.requiredCorrectCount} von {questions.length} Fragen richtig.</p>}
              {Number(passingScore) === 0 && passingScore.trim() && <p className="text-sm text-muted-foreground">Bei 0% kann eine vollständige Abgabe auch ohne richtige Antwort bestehen.</p>}
              <p className="text-sm text-muted-foreground">Änderungen bleiben privat, bis du den Kurs ausdrücklich veröffentlichst.</p>
            </div>
          </details>
          {readiness.issues.length ? <details className={styles.disclosure}>
            <summary>{readiness.issues.length} {readiness.issues.length === 1 ? 'Punkt' : 'Punkte'} vor dem Speichern prüfen</summary>
            <ul className="space-y-2 text-sm">{readiness.issues.map(issue => <li key={issue.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><span className="min-w-0 flex-1 basis-40 break-words [overflow-wrap:anywhere]">{issue.message}</span>{issue.questionId && <Button type="button" size="sm" variant="ghost" aria-label={issue.message} onClick={() => focusQuestion(issue.questionId!)}>Frage prüfen</Button>}</li>)}</ul>
          </details> : <p className="py-3 text-sm text-muted-foreground">Alle Fragen vollständig ausgefüllt.</p>}
        </TabsContent>

        <TabsContent value="preview">
          <Card className="rounded-none border-0 bg-transparent shadow-none">
            <CardHeader className="px-0">
              <CardTitle className="flex items-center gap-2"><Eye className="h-5 w-5" />Quiz Vorschau</CardTitle>
            </CardHeader>
            <CardContent className="px-0"><QuizAuthorPreview courseId={courseId ?? ''} content={draft()} disabled={disabled || isSaving} /></CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
      {showSaveButton && <Button type="button" onClick={handleSave} disabled={disabled || isSaving}>{isSaving ? 'Quiz wird gespeichert…' : 'Quiz speichern'}</Button>}
    </fieldset>
  );
}
