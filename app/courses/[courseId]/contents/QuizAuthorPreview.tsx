'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getQuizAuthoringReadiness } from './quiz-authoring';
import { QuizStage, isQuizQuestionAnswered } from './QuizStage';
import type { LearnerQuizQuestion, QuizQuestion } from './types';
import styles from './QuizStage.module.css';
import { hasQuizOptionImagesField, projectQuizOptionImagesForLearner } from '@/lib/quiz-media-contract';

export interface QuizAuthorPreviewProps {
  content: unknown;
  courseId: string;
  disabled?: boolean;
  activeQuestionId?: string | null;
  singleQuestion?: boolean;
}

/** An explicit boundary: no solution, explanation, or private metadata reaches the stage. */
function publicAuthorQuestion(question: QuizQuestion, courseId: string): LearnerQuizQuestion | null {
  const base = { id: question.id, question: question.question };
  switch (question.type) {
    case 'SINGLE_CHOICE': case 'MULTIPLE_CHOICE': {
      if (!hasQuizOptionImagesField(question)) return { ...base, type: question.type, options: [...question.options] };
      // Local incomplete captions remain visibly incomplete in rehearsal; this
      // temporary validation input never reaches storage or the returned caption.
      const validationInput = { ...question, options: question.options.map((option, index) => option.trim() ? option : `local-missing-caption-${index}`) };
      const media = projectQuizOptionImagesForLearner(validationInput, courseId);
      if (!media.ok) return null;
      return { ...base, type: question.type, options: [...question.options], ...(media.value && { optionImages: media.value }) };
    }
    case 'TRUE_FALSE': return { ...base, type: question.type, options: [...question.options] };
    case 'MATCHING': return { ...base, type: 'MATCHING', pairs: question.pairs.map(pair => ({ left: pair.left })) };
    case 'FILL_BLANKS': return { ...base, type: 'FILL_BLANKS', text: question.text, blankCount: question.answers.length };
    case 'TEXT_INPUT': return { ...base, type: 'TEXT_INPUT' };
  }
}

/** Author-only rehearsal. No request, score, pass, or completion callback exists. */
export function QuizAuthorPreview(props: QuizAuthorPreviewProps) {
  return <QuizAuthorPreviewState key={JSON.stringify(props.content)} {...props} />;
}

function QuizAuthorPreviewState({ content, courseId, disabled = false, activeQuestionId, singleQuestion = false }: QuizAuthorPreviewProps) {
  const readiness = getQuizAuthoringReadiness(content, undefined, courseId);
  const prefix = useId();
  const pendingNavigationFocus = useRef(false);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [showSolutions, setShowSolutions] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questions] = useState(() => {
    const ordered = [...(readiness.quiz?.questions ?? [])];
    // The builder follows the selected real question. Standalone rehearsal keeps its session shuffle.
    if (!singleQuestion && readiness.quiz?.shuffleQuestions) for (let index = ordered.length - 1; index > 0; index--) {
      const target = Math.floor(Math.random() * (index + 1));
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    }
    return ordered;
  });
  useEffect(() => {
    if (singleQuestion || !pendingNavigationFocus.current) return;
    pendingNavigationFocus.current = false;
    const prompt = document.getElementById(`${prefix}-prompt`);
    prompt?.focus({ preventScroll: true });
    prompt?.scrollIntoView?.({ block: 'nearest' });
  }, [questionIndex, prefix, singleQuestion]);
  if (!readiness.quiz) return <p role="alert" className="text-sm text-destructive">Die Quizdaten können nicht angezeigt werden. Der gespeicherte Inhalt bleibt erhalten.</p>;
  const index = singleQuestion ? Math.max(0, questions.findIndex(question => question.id === activeQuestionId)) : Math.min(questionIndex, Math.max(0, questions.length - 1));
  const authorQuestion = questions[index];
  const publicQuestions = questions.map(item => publicAuthorQuestion(item, courseId)).filter((item): item is LearnerQuizQuestion => item !== null);
  if (publicQuestions.length !== questions.length) return <p role="alert" className="text-sm text-destructive">Prüfe die Bilddetails im Editor. Die Vorschau zeigt keine unvollständig geprüften Antwortbilder.</p>;
  const question = publicQuestions[index];
  const goToQuestion = (nextIndex: number) => {
    pendingNavigationFocus.current = true;
    setQuestionIndex(Math.max(0, Math.min(questions.length - 1, nextIndex)));
  };
  const answeredCount = publicQuestions.filter(item => isQuizQuestionAnswered(item, answers[item.id])).length;

  return <section className="min-w-0 space-y-3" aria-label={singleQuestion ? 'Live-Quizvorschau' : 'Interaktive Quizvorschau'} onKeyDown={event => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  }}>
    <p className="text-xs leading-relaxed text-muted-foreground">{singleQuestion ? 'Live-Vorschau' : 'Vorschau'} · Antworten bleiben hier. Kein Versuch, Ergebnis oder Abschluss wird gespeichert.</p>
    {!readiness.ready && <p className="text-xs text-muted-foreground">Entwurf noch unvollständig. Hinweise im Editor prüfen.</p>}
    {question ? <>
      <QuizStage promptId={`${prefix}-prompt`} question={question} answer={answers[question.id]} onAnswerChange={answer => setAnswers(previous => ({ ...previous, [question.id]: answer }))} questionNumber={index + 1} totalQuestions={questions.length} answeredCount={answeredCount} disabled={disabled} />
      {!singleQuestion && <div className={styles.actions}>
        <Button type="button" variant="outline" className={styles.backAction} disabled={disabled || index === 0} onClick={() => goToQuestion(index - 1)}>Zurück</Button>
        {index < questions.length - 1 && <Button type="button" className={styles.primaryAction} disabled={disabled} onClick={() => goToQuestion(index + 1)}>Weiter</Button>}
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={disabled} aria-pressed={showSolutions} onClick={() => setShowSolutions(value => !value)}>{showSolutions ? 'Lösung ausblenden' : 'Autorenlösung anzeigen'}</Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={disabled || !Object.keys(answers).length} onClick={() => setAnswers({})}>Antworten zurücksetzen</Button>
      </div>
      {showSolutions && authorQuestion && <div className="space-y-2 rounded-lg border border-dashed p-3 text-sm" aria-label={`Autorenlösung für Frage ${index + 1}`}>
        <p className="font-medium">Nur für die Bearbeitung: Lösung</p>
        {(authorQuestion.type === 'SINGLE_CHOICE' || authorQuestion.type === 'MULTIPLE_CHOICE' || authorQuestion.type === 'TRUE_FALSE') && <ul className="list-inside list-disc break-words [overflow-wrap:anywhere]">{authorQuestion.correctAnswers.map(answerIndex => <li key={answerIndex}>{authorQuestion.options[answerIndex] || 'Antwort fehlt'}</li>)}</ul>}
        {authorQuestion.type === 'TEXT_INPUT' && <><p className="break-words [overflow-wrap:anywhere]">{authorQuestion.correctAnswer || 'Antwort fehlt'}</p><p className="text-xs text-muted-foreground">Exakter Textvergleich. {authorQuestion.caseSensitive ? 'Groß- und Kleinschreibung wird beachtet.' : 'Groß- und Kleinschreibung wird nicht beachtet.'}</p></>}
        {authorQuestion.type === 'MATCHING' && <ul className="space-y-1 break-words [overflow-wrap:anywhere]">{authorQuestion.pairs.map((pair, pairIndex) => <li key={pairIndex}>{pair.left} → {pair.right}</li>)}</ul>}
        {authorQuestion.type === 'FILL_BLANKS' && <ol className="list-inside list-decimal break-words [overflow-wrap:anywhere]">{authorQuestion.answers.map((answer, answerIndex) => <li key={answerIndex}>{answer || 'Antwort fehlt'}</li>)}</ol>}
        {authorQuestion.explanation && <p className="whitespace-pre-wrap break-words text-muted-foreground [overflow-wrap:anywhere]">{authorQuestion.explanation}</p>}
      </div>}
    </> : <p className={styles.empty}>Füge die erste Frage hinzu, um sie hier auszuprobieren.</p>}
    {!singleQuestion && <details className={styles.disclosure}><summary>Quizdetails</summary><p className="text-sm text-muted-foreground">Bestehensgrenze: {Number.isFinite(readiness.quiz.passingScore) ? `${readiness.quiz.passingScore}%` : 'noch festlegen'}. Jede Frage zählt gleich viel. Mehrteilige Antworten müssen vollständig richtig sein.</p>{readiness.quiz.shuffleQuestions && <p className="mt-2 text-sm text-muted-foreground">Die Fragen sind für diese Vorschau gemischt.</p>}</details>}
  </section>;
}
