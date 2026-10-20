'use client';

import { useId, useState, type ReactNode } from 'react';
import { isQuizImageAttributionSourceUrl, type LearnerQuizOptionImage } from '@/lib/quiz-media-contract';
import type { LearnerQuizQuestion } from './types';
import styles from './QuizStage.module.css';

/** The same image surface is used by learners and author rehearsal. */
function AnswerImage({ image }: { image: LearnerQuizOptionImage }) {
  const [failed, setFailed] = useState(false);
  return <span className={styles.answerImageStage}>
    {failed ? <span className={styles.answerImageFallback} role="img" aria-label={`Bild nicht verfügbar. ${image.alt}`}><span aria-hidden="true">Bild nicht verfügbar</span><span aria-hidden="true">{image.alt}</span></span>
      // Protected course assets must never enter the public image optimizer.
      // eslint-disable-next-line @next/next/no-img-element
      : <img src={image.src} alt={image.alt} className={styles.answerImage} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
  </span>;
}

export function isQuizQuestionAnswered(question: LearnerQuizQuestion, answer: unknown): boolean {
  switch (question.type) {
    case 'SINGLE_CHOICE': case 'TRUE_FALSE': return Array.isArray(answer) && answer.length === 1;
    case 'MULTIPLE_CHOICE': return Array.isArray(answer) && answer.length > 0;
    case 'TEXT_INPUT': return typeof answer === 'string' && Boolean(answer.trim());
    case 'MATCHING': case 'FILL_BLANKS': {
      const count = question.type === 'MATCHING' ? question.pairs.length : question.blankCount;
      return Array.isArray(answer) && count > 0 && answer.length === count &&
        Array.from({ length: count }, (_, index) => answer[index]).every(value => typeof value === 'string' && Boolean(value.trim()));
    }
  }
}

interface QuizStageProps {
  /** Callers construct an allowlisted public question, never an author object. */
  question: LearnerQuizQuestion;
  answer: unknown;
  onAnswerChange: (answer: unknown) => void;
  questionNumber: number;
  totalQuestions: number;
  answeredCount: number;
  disabled?: boolean;
  promptId?: string;
  children?: ReactNode;
}

/** Presentation and native answer inputs only. No grading, requests, or draft writes. */
export function QuizStage({ question, answer, onAnswerChange, questionNumber, totalQuestions, answeredCount, disabled = false, promptId, children }: QuizStageProps) {
  const prefix = useId();
  const headingId = promptId ?? `${prefix}-prompt`;
  const values = Array.isArray(answer) ? answer : [];
  const hasMixedImages = (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE') &&
    question.options.some((_, index) => Boolean(question.optionImages?.[index])) &&
    question.options.some((_, index) => !question.optionImages?.[index]);
  const setPart = (index: number, value: string) => {
    const next = [...values];
    next[index] = value;
    onAnswerChange(next);
  };
  const hint = question.type === 'MULTIPLE_CHOICE' ? 'Wähle alle passenden Antworten.'
    : question.type === 'SINGLE_CHOICE' || question.type === 'TRUE_FALSE' ? 'Wähle eine Antwort.'
      : question.type === 'MATCHING' ? 'Schreibe zu jedem Begriff die passende Zuordnung.'
        : question.type === 'FILL_BLANKS' ? 'Fülle die Lücken in der angegebenen Reihenfolge.' : 'Schreibe deine Antwort.';

  return <section className={styles.stage} aria-label={`Frage ${questionNumber}`} onKeyDown={event => {
    // A stage can be embedded in the author's enclosing live-save form.
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  }}>
    <header className={styles.stageHeader}>
      <p className={styles.step} aria-live="polite" aria-atomic="true">Frage {questionNumber} von {totalQuestions}</p>
      <progress className={styles.progress} value={answeredCount} max={Math.max(1, totalQuestions)} aria-label={`${answeredCount} von ${totalQuestions} Fragen beantwortet`} />
      <p className={styles.caption}>{answeredCount} von {totalQuestions} beantwortet</p>
    </header>
    <fieldset disabled={disabled} className={styles.answerFieldset} aria-labelledby={headingId}>
      <legend className="sr-only">Antwort zu Frage {questionNumber}</legend>
      <h3 id={headingId} tabIndex={-1} className={styles.prompt}>{question.question || 'Fragetext fehlt'}</h3>
      <p id={`${prefix}-hint`} className={styles.hint}>{hint}</p>
      {(question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE') && <div className={`${styles.choices} ${hasMixedImages ? styles.mixedChoices : question.optionImages?.some(Boolean) ? styles.imageChoices : ''}`} role="group" aria-describedby={`${prefix}-hint`}>
        {question.options.map((option, index) => {
          const selected = values.includes(index);
          const image = question.type !== 'TRUE_FALSE' ? question.optionImages?.[index] : null;
          return <div key={index} className={styles.choiceItem}>
            <label className={`${styles.choice} ${image ? styles.imageChoice : ''} ${selected ? styles.choiceSelected : ''}`}>
              {image && <AnswerImage key={image.src} image={image} />}
              <span className={styles.choiceCaption}>
                <input type={question.type === 'MULTIPLE_CHOICE' ? 'checkbox' : 'radio'} name={`${prefix}-answer`} value={index} checked={selected} className={styles.choiceControl} onChange={event => {
                  if (question.type !== 'MULTIPLE_CHOICE') onAnswerChange([index]);
                  else onAnswerChange(event.target.checked ? [...values.filter(value => value !== index), index].sort((a, b) => Number(a) - Number(b)) : values.filter(value => value !== index));
                }} />
                <span className={styles.choiceLetter} aria-hidden="true">{selected ? '✓' : String.fromCharCode(65 + index)}</span>
                <span className={styles.choiceText}>{option || `Antwort ${index + 1} fehlt`}</span>
              </span>
            </label>
            {image?.attribution && <p className={styles.imageCredit}>
              {image.attribution.sourceUrl && isQuizImageAttributionSourceUrl(image.attribution.sourceUrl)
                ? <a href={image.attribution.sourceUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{image.attribution.text}<span className="sr-only"> (öffnet in einem neuen Tab)</span></a>
                : <span>{image.attribution.text}</span>}
              {image.attribution.licenseLabel && <span> · {image.attribution.licenseLabel}</span>}
            </p>}
          </div>;
        })}
      </div>}
      {question.type === 'TEXT_INPUT' && <label className={styles.part}><span>Deine Antwort</span><input className={styles.textInput} value={typeof answer === 'string' ? answer : ''} maxLength={1000} onChange={event => onAnswerChange(event.target.value)} aria-describedby={`${prefix}-hint`} /></label>}
      {question.type === 'MATCHING' && <div className={styles.parts}>{question.pairs.map((pair, index) => <label key={index} className={styles.part}><span>{pair.left || `Begriff ${index + 1} fehlt`}</span><input className={styles.textInput} value={typeof values[index] === 'string' ? values[index] : ''} maxLength={1000} onChange={event => setPart(index, event.target.value)} /></label>)}</div>}
      {question.type === 'FILL_BLANKS' && <div className={styles.parts}><p className={styles.blankText}>{question.text || 'Lückentext fehlt'}</p>{Array.from({ length: question.blankCount }, (_, index) => <label key={index} className={styles.part}><span>Lücke {index + 1}</span><input className={styles.textInput} value={typeof values[index] === 'string' ? values[index] : ''} maxLength={1000} onChange={event => setPart(index, event.target.value)} /></label>)}</div>}
      {children}
    </fieldset>
  </section>;
}
