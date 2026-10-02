'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Search, Upload, Loader2 } from 'lucide-react';

export interface H5PContentItem {
  id: string;
  title: string;
  contentType?: string;
  createdAt?: string;
}

interface H5PSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (content: H5PContentItem) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

const MAX_H5P_BYTES = 50 * 1024 * 1024;

export function H5PSelectionDialog({ open, onOpenChange, onSelect, disabled = false, onBusyChange }: H5PSelectionDialogProps) {
  const fieldId = useId();
  const [contents, setContents] = useState<H5PContentItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const uploadRequest = useRef<AbortController | null>(null);
  const uploading = useRef(false);

  const loadContents = async () => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/h5p/contents', { signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Die H5P-Inhalte konnten nicht geladen werden.');
      if (!Array.isArray(data)) throw new Error('Die H5P-Liste konnte nicht gelesen werden.');
      if (controller.signal.aborted) return;
      setContents(data.filter((item): item is H5PContentItem => item && typeof item.id === 'string' && typeof item.title === 'string'));
    } catch (failure) {
      if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : 'Die H5P-Inhalte konnten nicht geladen werden.');
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.resolve().then(() => { if (active) return loadContents(); });
    return () => { active = false; listRequest.current?.abort(); };
  }, [open]);

  useEffect(() => () => { listRequest.current?.abort(); uploadRequest.current?.abort(); }, []);

  const upload = async () => {
    if (!file || uploading.current || disabled) return;
    if (!file.name.toLowerCase().endsWith('.h5p')) { setUploadError('Wähle eine Datei mit der Endung .h5p.'); return; }
    if (!file.size || file.size > MAX_H5P_BYTES) { setUploadError('Das H5P-Paket muss zwischen 1 Byte und 50 MB groß sein.'); return; }
    uploading.current = true;
    setIsUploading(true);
    setUploadError(null);
    onBusyChange?.(true);
    const controller = new AbortController();
    uploadRequest.current = controller;
    try {
      const body = new FormData();
      body.append('h5p', file);
      const response = await fetch('/api/h5p/upload', { method: 'POST', body, signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Das H5P-Paket konnte nicht hochgeladen werden.');
      if (!data || typeof data.id !== 'string' || !data.id || typeof data.title !== 'string') throw new Error('Der Server hat keine gültigen H5P-Inhaltsdaten zurückgegeben.');
      if (controller.signal.aborted) return;
      const item: H5PContentItem = { id: data.id, title: data.title, contentType: data.contentType };
      setContents(previous => [item, ...previous.filter(content => content.id !== item.id)]);
      setFile(null);
      onSelect(item);
      onOpenChange(false);
    } catch (failure) {
      if (!controller.signal.aborted) setUploadError(failure instanceof Error ? failure.message : 'Das H5P-Paket konnte nicht hochgeladen werden.');
    } finally {
      uploading.current = false;
      setIsUploading(false);
      onBusyChange?.(false);
    }
  };

  const filtered = contents.filter(content => `${content.title} ${content.contentType || ''}`.toLocaleLowerCase('de').includes(searchTerm.trim().toLocaleLowerCase('de')));
  return (
    <Dialog open={open} onOpenChange={value => { if (!uploading.current) onOpenChange(value); }}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>H5P-Inhalt auswählen</DialogTitle><DialogDescription>Vorhandenes Paket auswählen oder eine .h5p-Datei hochladen.</DialogDescription></DialogHeader>
        <div className="space-y-3 border-b pb-4">
          <Label htmlFor={`${fieldId}-file`}>H5P-Paket (.h5p, maximal 50 MB)</Label>
          <Input id={`${fieldId}-file`} type="file" accept=".h5p" disabled={isUploading || disabled} onChange={event => { setFile(event.target.files?.[0] || null); setUploadError(null); }} />
          {uploadError && <p role="alert" className="text-sm text-destructive">{uploadError}</p>}
          <Button type="button" variant="outline" disabled={!file || isUploading || disabled} onClick={() => void upload()}>
            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{isUploading ? 'Paket wird hochgeladen…' : 'Hochladen und verwenden'}
          </Button>
        </div>
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="H5P-Inhalte suchen" placeholder="Titel oder Inhaltstyp suchen…" value={searchTerm} disabled={isUploading} onChange={event => setSearchTerm(event.target.value)} className="pl-9" /></div>
        {isLoading ? <p role="status" className="text-sm text-muted-foreground">H5P-Inhalte werden geladen…</p> : loadError ? <div><p role="alert" className="text-sm text-destructive">{loadError}</p><Button type="button" variant="outline" className="mt-2" disabled={isUploading || disabled} onClick={() => void loadContents()}>Erneut laden</Button></div> : filtered.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{contents.length ? 'Keine passenden H5P-Inhalte.' : 'Noch keine H5P-Pakete vorhanden.'}</p> : <ul className="space-y-2">{filtered.map(content => <li key={content.id}><button type="button" disabled={isUploading || disabled} className="flex w-full min-w-0 flex-col rounded-lg border px-4 py-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onClick={() => { onSelect(content); onOpenChange(false); }}><span className="break-words font-medium">{content.title}</span>{content.contentType && <span className="text-sm text-muted-foreground">{content.contentType}</span>}</button></li>)}</ul>}
      </DialogContent>
    </Dialog>
  );
}
