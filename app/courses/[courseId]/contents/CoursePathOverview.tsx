'use client';

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { chapterReleaseLabel } from '@/lib/course-release';
import { Button } from '@/components/ui/button';
import { getQuizAuthoringReadiness } from './quiz-authoring';
import { parseQuizContent, type CourseContent } from './types';

export interface CoursePathEntry {
  content: CourseContent;
  path: string;
  depth: number;
  isLeaf: boolean;
  isQuiz: boolean;
  findings: Array<{ id: string; kind: string; severity: 'error' | 'warning'; message: string; contentId: string; questionId?: string }>;
}

function quizLike(content: CourseContent): boolean {
  if (content.type === 'QUIZ') return true;
  if (content.type !== 'TEXT') return false;
  if (parseQuizContent(content.content)) return true;
  if (typeof content.content !== 'string') return true;
  try {
    const value = JSON.parse(content.content) as unknown;
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'questions'));
  } catch {
    return content.content.trimStart().startsWith('{') && /["']questions["']\s*:/.test(content.content);
  }
}

/** Authoring outline; learner access is computed separately by the server. */
export function getCoursePathEntries(contents: CourseContent[]): CoursePathEntry[] {
  const entries: CoursePathEntry[] = [];
  const ordered = (items: CourseContent[]) => [...items].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const stack = ordered(contents).map((content, index) => ({ content, path: String(index + 1), depth: 0 })).reverse();
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current.content.id)) continue;
    seen.add(current.content.id);
    const children = ordered(current.content.subContents ?? []);
    const isLeaf = children.length === 0;
    const isQuiz = quizLike(current.content);
    const findings: CoursePathEntry['findings'] = [];
    if (isQuiz && !isLeaf) findings.push({ id: `${current.content.id}:non-leaf-quiz`, kind: 'non-leaf-quiz', severity: 'warning', contentId: current.content.id, message: 'Dieses Quiz hat Unterthemen. Nur Quiz ohne Unterthemen können abgegeben werden.' });
    if (isQuiz) findings.push(...getQuizAuthoringReadiness(current.content.content, current.content.id).issues.map(issue => ({ ...issue, contentId: current.content.id })));
    else if (isLeaf && typeof current.content.content === 'string' && !current.content.content.trim()) findings.push({ id: `${current.content.id}:empty-content`, kind: 'empty-content', severity: 'warning', contentId: current.content.id, message: 'Für diesen Inhalt ist noch kein Material hinterlegt.' });
    entries.push({ ...current, isLeaf, isQuiz, findings });
    for (let index = children.length - 1; index >= 0; index--) stack.push({ content: children[index], path: `${current.path}.${index + 1}`, depth: current.depth + 1 });
  }
  return entries;
}

export interface CoursePathOverviewProps {
  contents: CourseContent[];
  disabled?: boolean;
  onContentSelect: (contentId: string) => void;
  onEditContent?: (contentId: string) => void;
}

const typeNames: Record<CourseContent['type'], string> = { TEXT: 'Text', VIDEO: 'Video', AUDIO: 'Audio', H5P: 'H5P', QUIZ: 'Quiz', ASSIGNMENT: 'Aufgabe' };

/** Mount only inside the owner/administrator authoring workspace. */
export function CoursePathOverview({ contents, disabled = false, onContentSelect, onEditContent }: CoursePathOverviewProps) {
  const entries = getCoursePathEntries(contents);
  const leaves = entries.filter(entry => entry.isLeaf);
  const chapters = entries.length - leaves.length;
  const quizzes = leaves.filter(entry => entry.isQuiz).length;
  const findings = entries.flatMap(entry => entry.findings);
  const titles = new Map(entries.map(entry => [entry.content.id, entry.content.title]));
  return <section className="min-w-0 space-y-5" aria-label="Lernpfad im Kurs">
    <div className="space-y-2 border-b pb-4">
      <h2 className="text-xl font-semibold tracking-tight">Lernpfad im Kurs</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">Prüfe Reihenfolge, Material und Voraussetzungen deiner Kursinhalte. Änderungen speicherst du im jeweiligen Inhalt.</p>
      <p className="text-sm">{chapters} Kapitel · {leaves.length} Inhalte ohne Unterthemen · davon {quizzes} Quiz</p>
      <p className="text-sm text-muted-foreground">Für den Kursabschluss zählen alle Inhalte ohne Unterthemen. Quiz müssen bestanden, Aufgaben durch die Kursleitung bewertet werden. Andere Inhalte bestätigen Lernende selbst.</p>
    </div>
    {!entries.length ? <p className="py-6 text-sm text-muted-foreground">Noch kein Lernpfad vorhanden. Lege im Inhaltsverzeichnis das erste Kapitel oder einen Inhalt an.</p> : <>
      <p className="text-sm font-medium">{findings.length ? `${findings.length} ${findings.length === 1 ? 'Hinweis' : 'Hinweise'} zur Inhaltspflege` : 'Keine Hinweise zur Inhaltspflege'}</p>
      <ol className="divide-y border-y" aria-label="Aktuelle Kursreihenfolge">
        {entries.map(entry => <li key={entry.content.id} className="min-w-0 py-4" style={{ paddingInlineStart: `${Math.min(entry.depth, 3) * 12}px` }}>
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 basis-40 space-y-1">
              <p className="text-sm text-muted-foreground">{entry.path} · {entry.isLeaf ? entry.isQuiz ? 'Quiz' : typeNames[entry.content.type] : 'Kapitel'}</p>
              <h3 className="break-words text-base font-medium [overflow-wrap:anywhere]">{entry.content.title}</h3>
              {entry.content.releaseOn && <p className="text-sm text-muted-foreground">Freigabe ab {chapterReleaseLabel(entry.content.releaseOn)} · mit allen Unterthemen</p>}{!!entry.content.prerequisiteIds?.length && <p className="break-words text-sm text-muted-foreground">Erst nach: {entry.content.prerequisiteIds.map(id => titles.get(id) ?? 'Entfernter Inhalt').join(', ')}</p>}
              {!entry.isLeaf && <p className="text-sm text-muted-foreground">Bündelt {entry.content.subContents?.length ?? 0} Unterthemen</p>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`${entry.content.title} öffnen`} onClick={() => onContentSelect(entry.content.id)}>Öffnen</Button>
              {onEditContent && <Button type="button" variant="outline" size="sm" disabled={disabled} aria-label={`${entry.content.title} bearbeiten`} onClick={() => onEditContent(entry.content.id)}>Bearbeiten</Button>}
            </div>
          </div>
          {entry.findings.length > 0 && <ul className="mt-3 space-y-2 border-l-2 border-input pl-3 text-sm" aria-label={`Hinweise für ${entry.content.title}`}>{entry.findings.map(finding => <li key={finding.id} className="break-words [overflow-wrap:anywhere]">{finding.message}</li>)}</ul>}
        </li>)}
      </ol>
    </>}
  </section>;
}
