"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useSession } from 'next-auth/react'
import { toast } from 'react-toastify'
import { ArrowLeft, Briefcase, Check, ImageIcon, Loader2, Plus, X } from 'lucide-react'
import { AppShell, AppHeader } from '@/components/app-shell'
import { Sidebar } from '@/components/Sidebar'
import { UserNav } from '@/components/user-nav'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Editor } from '@/components/Editor'
import { getSafeHttpUrl } from '@/lib/security'
import { sanitizeTextPreview } from '@/lib/sanitize-html'

const CATEGORIES = ['Web Development', 'Mobile App', 'Desktop Application', 'Machine Learning', 'Data Science', 'Game Development', 'Other']

export default function NewProjectPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [currentTag, setCurrentTag] = useState('')
  const [link, setLink] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [failedImageUrl, setFailedImageUrl] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState('')
  const previewUrl = getSafeHttpUrl(imageUrl.trim())

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login?callbackUrl=%2Fprojects%2Fnew')
  }, [status, router])

  const validateForm = () => {
    const nextErrors: Record<string, string> = {}
    if (!title.trim()) nextErrors.title = 'Bitte geben Sie einen Projekttitel ein.'
    // Markup and empty paragraphs must not satisfy the minimum description length.
    const descriptionText = new DOMParser().parseFromString(sanitizeTextPreview(description), 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (descriptionText.length < 50) nextErrors.description = 'Bitte beschreiben Sie Ihr Projekt mit mindestens 50 Zeichen.'
    if (!category) nextErrors.category = 'Bitte wählen Sie eine Kategorie.'
    if (!getSafeHttpUrl(link.trim())) nextErrors.link = 'Bitte geben Sie eine gültige HTTP- oder HTTPS-Adresse ein.'
    if (imageUrl.trim() && !previewUrl) nextErrors.imageUrl = 'Bitte geben Sie eine gültige HTTP- oder HTTPS-Bildadresse ein.'
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleAddTag = () => {
    const tag = currentTag.trim()
    if (!tag) return
    if (!tags.includes(tag) && tags.length < 20) setTags(values => [...values, tag])
    setCurrentTag('')
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isSubmitting || !session?.user?.id) return
    setSubmitError('')
    if (!validateForm()) return
    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/users/${session.user.id}/projects`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description, category, tags, link: link.trim(), imageUrl: imageUrl.trim() }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || 'Das Projekt konnte nicht eingereicht werden. Bitte versuchen Sie es erneut.')
      }
      toast.success('Projekt erfolgreich eingereicht!')
      router.push('/showcases')
    } catch (failure) {
      setSubmitError(failure instanceof Error ? failure.message : 'Das Projekt konnte nicht eingereicht werden.')
    } finally { setIsSubmitting(false) }
  }

  const fieldError = (field: string) => errors[field] ? <p id={`${field}-error`} className="text-sm text-destructive">{errors[field]}</p> : null

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader><div className="flex items-center justify-between gap-3"><h1 className="flex min-w-0 items-center gap-2"><Briefcase className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><span className="truncate">Neues Projekt</span></h1><div className="flex shrink-0 items-center gap-2"><ThemeToggle /><UserNav /></div></div></AppHeader>
        <main id="page-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 lg:p-8">
          {status !== 'authenticated' ? <p role="status" className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />{status === 'loading' ? 'Konto wird geladen…' : 'Weiterleitung zur Anmeldung…'}</p> : <div className="mx-auto max-w-5xl space-y-6">
            <Link href="/showcases" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Alle Projekte</Link>
            <div className="max-w-2xl space-y-2"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Projekt-Showcase</p><h2 className="text-3xl font-semibold tracking-tight">Zeigen Sie, was Sie gebaut haben.</h2><p className="text-muted-foreground">Teilen Sie Ihr Projekt, die Idee dahinter und Ihre Erfahrungen mit der Community.</p></div>
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
              <Card><CardHeader className="border-b"><CardTitle className="text-lg">Projektdetails</CardTitle><p className="text-sm text-muted-foreground">Mit * markierte Felder sind erforderlich.</p></CardHeader><CardContent className="pt-6">
                <form onSubmit={handleSubmit} className="space-y-6" aria-busy={isSubmitting} noValidate>
                  {Object.keys(errors).length > 0 && <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">Bitte überprüfen Sie die markierten Felder.</p>}
                  <fieldset disabled={isSubmitting} className="min-w-0 space-y-6">
                    <div className="space-y-2"><Label htmlFor="title">Titel *</Label><Input id="title" name="title" maxLength={300} value={title} onChange={event => setTitle(event.target.value)} placeholder="Zum Beispiel: Mein Community-Dashboard" required aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? 'title-error' : undefined} />{fieldError('title')}</div>
                    <div className="space-y-2"><p id="description-label" className="text-sm font-medium">Beschreibung *</p><p id="description-help" className="text-xs text-muted-foreground">Erklären Sie das Ziel, die wichtigsten Funktionen und Ihren Technologie-Stack. Mindestens 50 Zeichen.</p><div role="group" aria-labelledby="description-label" aria-describedby={errors.description ? 'description-error description-help' : 'description-help'} className={errors.description ? 'rounded-lg ring-1 ring-destructive' : undefined}><Editor content={description} onChange={setDescription} className="min-h-[220px]" readOnly={isSubmitting} /></div>{fieldError('description')}</div>
                    <div className="space-y-2"><Label htmlFor="category">Kategorie *</Label><Select value={category} onValueChange={setCategory} disabled={isSubmitting}><SelectTrigger id="category" aria-required="true" aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? 'category-error' : undefined}><SelectValue placeholder="Kategorie auswählen" /></SelectTrigger><SelectContent>{CATEGORIES.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>{fieldError('category')}</div>
                    <div className="space-y-2"><Label htmlFor="tags">Tags <span className="font-normal text-muted-foreground">(optional)</span></Label><div className="flex gap-2"><Input id="tags" maxLength={60} value={currentTag} onChange={event => setCurrentTag(event.target.value)} placeholder="Zum Beispiel: React" disabled={isSubmitting || tags.length >= 20} aria-describedby="tags-help" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); handleAddTag() } }} /><Button type="button" variant="outline" onClick={handleAddTag} disabled={!currentTag.trim() || tags.length >= 20} aria-label="Tag hinzufügen"><Plus className="h-4 w-4" aria-hidden="true" /><span className="ml-1 hidden sm:inline">Hinzufügen</span></Button></div><p id="tags-help" className="text-xs text-muted-foreground">Mit Enter hinzufügen. {tags.length}/20 Tags.</p><div className="flex flex-wrap gap-2">{tags.map(tag => <span key={tag} className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1 text-xs"><span className="break-all">{tag}</span><button type="button" onClick={() => setTags(values => values.filter(value => value !== tag))} aria-label={`Tag ${tag} entfernen`} className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3.5 w-3.5" aria-hidden="true" /></button></span>)}</div></div>
                    <div className="space-y-2"><Label htmlFor="link">Projekt-Link *</Label><Input id="link" name="link" type="url" inputMode="url" maxLength={2048} value={link} onChange={event => setLink(event.target.value)} placeholder="https://github.com/…" required aria-invalid={Boolean(errors.link)} aria-describedby={errors.link ? 'link-error' : 'link-help'} /><p id="link-help" className="text-xs text-muted-foreground">Eine Website, ein Repository oder eine öffentlich erreichbare Demo.</p>{fieldError('link')}</div>
                    <div className="space-y-2"><Label htmlFor="imageUrl">Vorschaubild <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="imageUrl" name="imageUrl" type="url" inputMode="url" maxLength={2048} value={imageUrl} onChange={event => setImageUrl(event.target.value)} placeholder="https://example.com/projekt.jpg" aria-invalid={Boolean(errors.imageUrl)} aria-describedby={errors.imageUrl ? 'imageUrl-error' : undefined} />{fieldError('imageUrl')}{previewUrl && <div className="relative mt-3 flex h-48 w-full items-center justify-center overflow-hidden rounded-xl border bg-muted">{failedImageUrl === previewUrl ? <p role="status" className="flex items-center gap-2 px-4 text-sm text-muted-foreground"><ImageIcon className="h-4 w-4 shrink-0" aria-hidden="true" />Das Vorschaubild konnte nicht geladen werden.</p> : <Image src={previewUrl} alt="Vorschau des Projektbilds" fill sizes="(max-width: 1024px) 100vw, 650px" className="object-cover" onError={() => setFailedImageUrl(previewUrl)} />}</div>}</div>
                  </fieldset>
                  {submitError && <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{submitError}</p>}
                  <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => router.push('/showcases')} disabled={isSubmitting}>Abbrechen</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}{isSubmitting ? 'Projekt wird eingereicht…' : 'Projekt einreichen'}</Button></div>
                </form>
              </CardContent></Card>
              <aside className="space-y-4 rounded-2xl border bg-card p-5"><h3 className="font-semibold">Ein guter erster Eindruck</h3><ul className="space-y-4 text-sm leading-relaxed text-muted-foreground">{['Ein klarer Titel macht Ihre Idee sofort verständlich.', 'Beschreiben Sie, was Sie gelernt haben und welches Problem Sie lösen.', 'Ein Vorschaubild und passende Tags helfen beim Entdecken.'].map(tip => <li key={tip} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span>{tip}</span></li>)}</ul></aside>
            </div>
          </div>}
        </main>
      </div>
    </AppShell>
  )
}
