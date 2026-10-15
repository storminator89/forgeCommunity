'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageState } from '@/components/page-state';
import { SkillIcon } from './skill-icons';

export interface SkillOption { id: string; name: string; category: string }
interface OwnSkill { id: string; skillId: string; level: number; endorsements: number; skill: SkillOption }
const selectClass = 'h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-base focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:text-sm';

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Die Änderung konnte nicht gespeichert werden.');
  return data as T;
}

interface WorkbenchProps {
  viewerId: string;
  catalog: SkillOption[];
  catalogLoading?: boolean;
  catalogError?: boolean;
  onCatalogRetry?: () => void;
  onChanged: () => void;
  onCatalogCreated?: (skill: SkillOption) => void;
}

export function OwnSkillsWorkbench(props: WorkbenchProps) {
  return <OwnSkillsForViewer key={props.viewerId} {...props} />;
}

function OwnSkillsForViewer({ viewerId, catalog, catalogLoading = false, catalogError = false,
  onCatalogRetry, onChanged, onCatalogCreated }: WorkbenchProps) {
  const [rows, setRows] = useState<OwnSkill[]>([]);
  const [extraSkills, setExtraSkills] = useState<SkillOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editor, setEditor] = useState<'add' | OwnSkill | null>(null);
  const [removing, setRemoving] = useState<OwnSkill | null>(null);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [skillId, setSkillId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('33');
  const [pending, setPending] = useState(false);
  const flight = useRef(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const lifetime = useRef<AbortController | null>(null);
  const options = [...new Map([...catalog, ...extraSkills].map(skill => [skill.id, skill])).values()]
    .filter(skill => !rows.some(row => row.skillId === skill.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));

  async function load(signal: AbortSignal) {
    const data = await fetch('/api/user/skills', { cache: 'no-store', signal }).then(readResponse<OwnSkill[]>);
    if (!signal.aborted) { setRows(data); setLoadError(''); }
  }

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void Promise.resolve().then(() => load(controller.signal)).catch(() => {
      if (!controller.signal.aborted) setLoadError('Deine Fähigkeiten konnten nicht geladen werden.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [viewerId]);

  const retry = async () => {
    const signal = lifetime.current?.signal;
    if (!signal) return;
    setLoading(true);
    try { await load(signal); } catch { if (!signal.aborted) setLoadError('Deine Fähigkeiten konnten nicht geladen werden.'); }
    finally { if (!signal.aborted) setLoading(false); }
  };

  const openEditor = (row?: OwnSkill, trigger?: HTMLButtonElement) => {
    opener.current = trigger ?? addButton.current;
    setEditor(row ?? 'add'); setMode(options.length || catalogLoading || catalogError ? 'existing' : 'new'); setSkillId('');
    setName(''); setCategory(''); setLevel(String(row?.level ?? 33)); setError(''); setMessage('');
  };

  const restoreFocus = () => {
    const available = (button: HTMLButtonElement | null) => button?.isConnected && !button.disabled;
    const target = [opener.current, addButton.current, retryButton.current].find(available);
    target?.focus();
  };

  async function mutate(action: (signal: AbortSignal) => Promise<void>, success: string) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || flight.current) return;
    flight.current = true; setPending(true); setError(''); setMessage('');
    try {
      await action(signal);
      if (signal.aborted) return;
      onChanged();
      try { await load(signal); }
      catch { if (!signal.aborted) setLoadError('Gespeichert. Lade die Liste erneut, um den aktuellen Stand zu sehen.'); }
      if (!signal.aborted) { setEditor(null); setRemoving(null); setMessage(success); }
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'Bitte versuche es erneut.');
    } finally {
      flight.current = false;
      if (!signal.aborted) setPending(false);
    }
  }

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(level);
    if (!level.trim() || !Number.isInteger(value) || value < 0 || value > 100) {
      setError('Bitte gib eine ganze Zahl zwischen 0 und 100 ein.'); return;
    }
    if (!editor) return;
    void mutate(async signal => {
      if (editor !== 'add') {
        await fetch(`/api/user/skills/${encodeURIComponent(editor.skillId)}`, {
          method: 'PUT', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level: value }),
        }).then(readResponse);
        return;
      }
      let selectedId = skillId;
      if (mode === 'new') {
        const created = await fetch('/api/skills', {
          method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), category: category.trim() || 'Unkategorisiert' }),
        }).then(readResponse<SkillOption>);
        if (signal.aborted) return;
        // A failed attach can be retried without creating the same catalog item twice.
        setExtraSkills(previous => [...previous, created]); setMode('existing'); setSkillId(created.id);
        onCatalogCreated?.(created);
        selectedId = created.id;
      }
      if (!selectedId) throw new Error('Wähle eine Fähigkeit aus.');
      await fetch('/api/user/skills', {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skillId: selectedId, level: value }),
      }).then(readResponse);
    }, editor === 'add' ? 'Fähigkeit hinzugefügt.' : 'Selbsteinschätzung gespeichert.');
  };

  return <section aria-labelledby="own-skills-title" className="min-w-0 py-7">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
      <div><h2 id="own-skills-title" className="text-xl font-semibold tracking-tight">Deine Fähigkeiten</h2><p className="mt-1 text-sm text-muted-foreground">Deine Selbsteinschätzung ist im Mitgliederprofil sichtbar.</p></div>
      <Button ref={addButton} type="button" disabled={loading || Boolean(loadError) || pending} onClick={event => openEditor(undefined, event.currentTarget)}><SkillIcon name="plus" />Fähigkeit hinzufügen</Button>
    </div>
    {message && <p role="status" className="mt-4 text-sm">{message}</p>}
    {loading ? <PageState kind="loading" title="Deine Fähigkeiten werden geladen" />
      : loadError ? <PageState kind="error" title={loadError} action={<Button ref={retryButton} variant="outline" onClick={() => void retry()}>Liste erneut laden</Button>} />
      : rows.length === 0 ? <PageState title="Womit kennst du dich aus?" description="Ergänze deine erste Fähigkeit." action={<Button variant="outline" onClick={event => openEditor(undefined, event.currentTarget)}>Erste Fähigkeit hinzufügen</Button>} />
      : <ul className="divide-y">{rows.map(row => <li key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-4 py-5">
        <div className="flex w-full min-w-0 items-start gap-3 sm:w-auto sm:flex-1"><SkillIcon name="skills" className="mt-1 shrink-0 text-muted-foreground" /><div className="min-w-0"><h3 className="break-words font-medium [overflow-wrap:anywhere]">{row.skill.name}</h3><p className="mt-1 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{row.skill.category} · Selbsteinschätzung {row.level}%</p><p className="mt-1 text-xs text-muted-foreground">{row.endorsements} Skill-{row.endorsements === 1 ? 'Empfehlung' : 'Empfehlungen'}</p></div></div>
        <div className="flex flex-wrap gap-1"><Button variant="ghost" size="sm" disabled={pending} aria-label={`${row.skill.name} bearbeiten`} onClick={event => openEditor(row, event.currentTarget)}><SkillIcon name="edit" />Bearbeiten</Button><Button variant="ghost" size="sm" disabled={pending} aria-label={`${row.skill.name} entfernen`} onClick={event => { opener.current = event.currentTarget; setRemoving(row); setError(''); }}><SkillIcon name="remove" />Entfernen</Button></div>
      </li>)}</ul>}
    <nav aria-label="Weiterlernen" className="mt-5 flex flex-wrap gap-x-6 gap-y-3 border-t pt-5 text-sm">
      <Link href="/courses" className="inline-flex min-h-11 items-center gap-2 rounded-md underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"><SkillIcon name="learn" />Kurse entdecken</Link>
      <Link href="/courses/pathways" className="inline-flex min-h-11 items-center rounded-md underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Lernpfade</Link>
      <Link href="/settings?tab=certificates" className="inline-flex min-h-11 items-center rounded-md underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Meine Zertifikate</Link>
      <Link href={`/profile/${encodeURIComponent(viewerId)}`} className="inline-flex min-h-11 items-center gap-2 rounded-md underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Mein Profil<SkillIcon name="arrow" /></Link>
    </nav>
    <Dialog open={editor !== null} onOpenChange={open => { if (!open && !pending) setEditor(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}><DialogHeader><DialogTitle>{editor === 'add' ? 'Fähigkeit hinzufügen' : 'Fähigkeit bearbeiten'}</DialogTitle><DialogDescription className="break-words [overflow-wrap:anywhere]">{editor && editor !== 'add' ? editor.skill.name : 'Wähle aus dem Verzeichnis oder ergänze eine Fähigkeit.'}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="min-w-0 space-y-5">
          {editor === 'add' && <><div role="group" aria-label="Fähigkeit wählen oder erstellen" className="flex flex-wrap gap-2"><Button type="button" variant={mode === 'existing' ? 'secondary' : 'ghost'} aria-pressed={mode === 'existing'} disabled={pending} onClick={() => setMode('existing')}>Aus Verzeichnis</Button><Button type="button" variant={mode === 'new' ? 'secondary' : 'ghost'} aria-pressed={mode === 'new'} disabled={pending} onClick={() => setMode('new')}>Neu erstellen</Button></div>
          {mode === 'existing' ? <div className="space-y-2"><Label htmlFor="own-skill-choice">Fähigkeit</Label><select id="own-skill-choice" className={selectClass} value={skillId} onChange={event => setSkillId(event.target.value)} disabled={pending || catalogLoading || catalogError} required><option value="">Fähigkeit auswählen</option>{options.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select>
            {catalogLoading ? <p role="status" className="text-sm text-muted-foreground">Verzeichnis wird geladen …</p>
              : catalogError ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm"><span>Verzeichnis nicht verfügbar.</span><Button type="button" variant="outline" size="sm" disabled={pending} onClick={onCatalogRetry}>Erneut laden</Button></div>
              : options.length === 0 && <p className="text-sm text-muted-foreground">{catalog.length === 0 && extraSkills.length === 0 ? 'Im Verzeichnis sind noch keine Fähigkeiten.' : 'Alle vorhandenen Fähigkeiten sind bereits in deinem Profil.'}</p>}</div>
          : <><div className="space-y-2"><Label htmlFor="own-skill-name">Name der Fähigkeit</Label><Input id="own-skill-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} required disabled={pending} /></div><div className="space-y-2"><Label htmlFor="own-skill-category">Kategorie</Label><Input id="own-skill-category" value={category} onChange={event => setCategory(event.target.value)} maxLength={120} placeholder="Unkategorisiert" disabled={pending} /></div></>}</>}
          <div className="space-y-2"><Label htmlFor="own-skill-level">Selbsteinschätzung (0–100%)</Label><Input id="own-skill-level" type="number" inputMode="numeric" min={0} max={100} step={1} value={level} onChange={event => setLevel(event.target.value)} required disabled={pending} aria-describedby="own-skill-level-hint" /><p id="own-skill-level-hint" className="text-sm text-muted-foreground">0: noch keine Erfahrung · 100: sehr sicher</p></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => setEditor(null)}>Abbrechen</Button><Button type="submit" disabled={pending || (editor === 'add' && mode === 'existing' && (catalogLoading || catalogError))}>{pending ? 'Wird gespeichert…' : 'Speichern'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(removing)} onOpenChange={open => { if (!open && !pending) setRemoving(null); }}><DialogContent onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}><DialogHeader><DialogTitle>Fähigkeit entfernen?</DialogTitle><DialogDescription className="break-words [overflow-wrap:anywhere]">{removing?.skill.name} wird aus deinem Profil entfernt. Zugehörige Skill-Empfehlungen gehen verloren.</DialogDescription></DialogHeader>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter className="gap-2"><Button variant="outline" disabled={pending} onClick={() => setRemoving(null)}>Behalten</Button><Button variant="destructive" disabled={pending} onClick={() => { if (removing) void mutate(async signal => { await fetch(`/api/user/skills/${encodeURIComponent(removing.skillId)}`, { method: 'DELETE', signal }).then(readResponse); }, 'Fähigkeit entfernt.'); }}>{pending ? 'Wird entfernt…' : 'Fähigkeit entfernen'}</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
