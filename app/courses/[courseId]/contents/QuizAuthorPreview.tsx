'use client';

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { getQuizAuthoringReadiness, quizQuestionTypeLabel } from './quiz-authoring';
import type { QuizQuestion } from './types';

export interface QuizAuthorPreviewProps { content: unknown; disabled?: boolean }

function answered(question: QuizQuestion, answer: unknown): boolean {
  if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE') return Array.isArray(answer) && answer.length > 0;
  if (question.type === 'TEXT_INPUT') return typeof answer === 'string' && Boolean(answer.trim());
  const count = question.type === 'MATCHING' ? question.pairs.length : question.type === 'FILL_BLANKS' ? question.answers.length : 0;
  return Array.isArray(answer) && count > 0 && Array.from({ length: count }, (_, index) => answer[index]).every(value => typeof value === 'string' && Boolean(value.trim()));
}

/** Author-only rehearsal. No request, score, pass, or completion callback exists. */
export function QuizAuthorPreview(props: QuizAuthorPreviewProps) {
  return <QuizAuthorPreviewState key={JSON.stringify(props.content)} {...props} />;
}

function QuizAuthorPreviewState({ content, disabled = false }: QuizAuthorPreviewProps) {
  const prefix = useId();
  const readiness = getQuizAuthoringReadiness(content);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [showSolutions, setShowSolutions] = useState(false);
  const [questions] = useState(() => {
    const ordered = [...(readiness.quiz?.questions ?? [])];
    if (readiness.quiz?.shuffleQuestions) for (let index = ordered.length - 1; index > 0; index--) {
      const target = Math.floor(Math.random() * (index + 1));
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    }
    return ordered;
  });
  if (!readiness.quiz) return <p role="alert" className="text-sm text-destructive">Die Quizdaten können nicht angezeigt werden. Der gespeicherte Inhalt bleibt erhalten.</p>;
  const setAnswer = (id: string, answer: unknown) => setAnswers(previous => ({ ...previous, [id]: answer }));
  const setTextPart = (id: string, index: number, value: string) => {
    const parts = Array.isArray(answers[id]) ? [...answers[id] as string[]] : [];
    parts[index] = value;
    setAnswer(id, parts);
  };
  const answeredCount = questions.filter(question => answered(question, answers[question.id])).length;

  return <section className="min-w-0 space-y-5" aria-label="Interaktive Quizvorschau" onKeyDown={event => {
    // This rehearsal is also embedded in the live-save author form. Enter in
    // a local answer must never submit that enclosing course-edit form.
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement &&
        event.target.type !== 'radio' && event.target.type !== 'checkbox') event.preventDefault();
  }}>
    <div className="space-y-2 border-b pb-4">
      <p className="text-sm leading-relaxed text-muted-foreground">Probiere die Eingabefelder aus. Vorschauantworten bleiben nur in dieser Ansicht. Es wird kein Versuch und kein Abschluss gespeichert.</p>
      <p className="text-sm">Bestehensgrenze: {Number.isFinite(readiness.quiz.passingScore) ? `${readiness.quiz.passingScore}%` : 'noch festlegen'}. Jede Frage zählt gleich viel. Mehrteilige Antworten müssen vollständig richtig sein.</p>
      {!readiness.ready && <p className="text-sm text-destructive">Dieser Entwurf ist noch unvollständig. Prüfe die Hinweise im Quizeditor.</p>}
      {readiness.quiz.shuffleQuestions && <p className="text-sm text-muted-foreground">Die Fragen sind für diese Vorschau gemischt.</p>}
    </div>
    <fieldset disabled={disabled} className="min-w-0 space-y-6">
      <legend className="sr-only">Vorschauantworten</legend>
      {questions.map((question, questionIndex) => {
        const values = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : [];
        return <fieldset key={question.id} className="min-w-0 space-y-3 border-b pb-6">
          <legend className="max-w-full break-words text-base font-semibold [overflow-wrap:anywhere]">{questionIndex + 1}. {question.question || 'Fragetext fehlt'}</legend>
          <p className="text-sm text-muted-foreground">{quizQuestionTypeLabel(question.type)}</p>
          {(question.type === 'SINGLE_CHOICE' || question.type === 'TRUE_FALSE') && <RadioGroup aria-label={`Vorschauantwort zu Frage ${questionIndex + 1}`} value={Array.isArray(answers[question.id]) ? String((answers[question.id] as number[])[0] ?? '') : ''} onValueChange={value => setAnswer(question.id, [Number(value)])}>
            {question.options.map((option, index) => <div key={index} className="flex min-h-11 items-center gap-3"><RadioGroupItem id={`${prefix}-${question.id}-${index}`} value={String(index)} /><Label className="min-w-0 break-words [overflow-wrap:anywhere]" htmlFor={`${prefix}-${question.id}-${index}`}>{option || `Antwort ${index + 1} fehlt`}</Label></div>)}
          </RadioGroup>}
          {question.type === 'MULTIPLE_CHOICE' && question.options.map((option, index) => <div key={index} className="flex min-h-11 items-center gap-3"><Checkbox id={`${prefix}-${question.id}-${index}`} checked={Array.isArray(answers[question.id]) && (answers[question.id] as number[]).includes(index)} onCheckedChange={checked => {
            const current = Array.isArray(answers[question.id]) ? answers[question.id] as number[] : [];
            setAnswer(question.id, checked === true ? [...current, index].sort((a, b) => a - b) : current.filter(value => value !== index));
          }} /><Label className="min-w-0 break-words [overflow-wrap:anywhere]" htmlFor={`${prefix}-${question.id}-${index}`}>{option || `Antwort ${index + 1} fehlt`}</Label></div>)}
          {question.type === 'TEXT_INPUT' && <div className="space-y-2"><Input aria-label={`Vorschauantwort zu Frage ${questionIndex + 1}`} value={typeof answers[question.id] === 'string' ? answers[question.id] as string : ''} maxLength={1000} onChange={event => setAnswer(question.id, event.target.value)} /><p className="text-sm text-muted-foreground">Kurze Antwort mit exaktem Textvergleich. {question.caseSensitive ? 'Groß- und Kleinschreibung wird beachtet.' : 'Groß- und Kleinschreibung wird nicht beachtet.'}</p></div>}
          {question.type === 'MATCHING' && question.pairs.map((pair, index) => <div key={index} className="space-y-2"><Label className="break-words [overflow-wrap:anywhere]" htmlFor={`${prefix}-${question.id}-${index}`}>{pair.left || `Linker Teil ${index + 1} fehlt`}</Label><Input id={`${prefix}-${question.id}-${index}`} value={values[index] ?? ''} maxLength={1000} onChange={event => setTextPart(question.id, index, event.target.value)} /></div>)}
          {question.type === 'FILL_BLANKS' && <><p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{question.text}</p>{question.answers.map((_, index) => <div key={index} className="space-y-2"><Label htmlFor={`${prefix}-${question.id}-${index}`}>Frage {questionIndex + 1}, Lücke {index + 1}</Label><Input id={`${prefix}-${question.id}-${index}`} value={values[index] ?? ''} maxLength={1000} onChange={event => setTextPart(question.id, index, event.target.value)} /></div>)}</>}
          {showSolutions && <div className="space-y-2 rounded-lg bg-muted p-3 text-sm" aria-label={`Lösung für Frage ${questionIndex + 1}`}>
            <p className="font-medium">Lösung</p>
            {(question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE') && <ul className="list-inside list-disc break-words [overflow-wrap:anywhere]">{question.correctAnswers.map(index => <li key={index}>{question.options[index] || 'Antwort fehlt'}</li>)}</ul>}
            {question.type === 'TEXT_INPUT' && <p className="break-words [overflow-wrap:anywhere]">{question.correctAnswer || 'Antwort fehlt'}</p>}
            {question.type === 'MATCHING' && <ul className="space-y-1 break-words [overflow-wrap:anywhere]">{question.pairs.map((pair, index) => <li key={index}>{pair.left} → {pair.right}</li>)}</ul>}
            {question.type === 'FILL_BLANKS' && <ol className="list-inside list-decimal break-words [overflow-wrap:anywhere]">{question.answers.map((answer, index) => <li key={index}>{answer || 'Antwort fehlt'}</li>)}</ol>}
            {question.explanation && <p className="break-words text-muted-foreground [overflow-wrap:anywhere]">{question.explanation}</p>}
          </div>}
        </fieldset>;
      })}
      {!questions.length && <p className="text-sm text-muted-foreground">Füge im Editor die erste Frage hinzu, um sie auszuprobieren.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" aria-pressed={showSolutions} onClick={() => setShowSolutions(value => !value)}>{showSolutions ? 'Lösungen ausblenden' : 'Lösungen anzeigen'}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={!Object.keys(answers).length} onClick={() => setAnswers({})}>Antworten zurücksetzen</Button>
      </div>
    </fieldset>
    <p role="status" className="text-sm text-muted-foreground">{answeredCount} von {questions.length} Vorschaufragen beantwortet. Diese Ansicht vergibt kein Ergebnis.</p>
  </section>;
}
