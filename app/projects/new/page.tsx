"use client"

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: editorial · macrostructure: project composer · design-system: design.md · designed-as-app */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useSession } from '@/lib/sites-auth/react'
import type { Session } from '@/lib/sites-auth/server'
import { toast } from 'react-toastify'
import { ArrowLeft, Briefcase, ImageIcon, Loader2, Plus, X } from 'lucide-react'
import { AppShell, AppHeader } from '@/components/app-shell'
import { Sidebar } from '@/components/Sidebar'
import { UserNav } from '@/components/user-nav'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Editor } from '@/components/Editor'
import { getSafeHttpUrl } from '@/lib/security'
import { sanitizeTextPreview } from '@/lib/sanitize-html'

const CATEGORIES = ['Web Development', 'Mobile App', 'Desktop Application', 'Machine Learning', 'Data Science', 'Game Development', 'Other']

export default function NewProjectPage() {
  const { data, status } = useSession()
  const session = status === 'authenticated' ? data : null
  return <ProjectComposer key={session?.user?.id ?? 'anonymous'} session={session} status={status} />
}

function ProjectComposer({ session, status }: { session: Session | null; status: ReturnType<typeof useSession>['status'] }) {
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
    <AppShell data-page-family="editor">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader><div className="app-header-row"><h1 className="app-header-title flex items-center gap-2"><Briefcase className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0">Neues Projekt</span></h1><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div></AppHeader>
        <main id="page-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto">
          {status !== 'authenticated' ? <p role="status" className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />{status === 'loading' ? 'Konto wird geladen…' : 'Weiterleitung zur Anmeldung…'}</p> : <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
            <div><Link href="/showcases" className="inline-flex min-h-11 items-center gap-2 rounded-[10px] text-sm text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Alle Projekte</Link></div>

            <div className="min-w-0 pt-6">
              <section aria-labelledby="project-details-title" className="fc-form-section min-w-0"><h2 id="project-details-title" className="text-lg font-semibold tracking-tight">Projektdetails</h2><p className="mt-2 text-sm text-muted-foreground">* Pflichtfeld</p><div className="pt-6">
                <form onSubmit={handleSubmit} className="space-y-6" aria-busy={isSubmitting} noValidate>
                  {Object.keys(errors).length > 0 && <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">Bitte überprüfen Sie die markierten Felder.</p>}
                  <fieldset disabled={isSubmitting} className="min-w-0 space-y-6">
                    <div className="space-y-2"><Label htmlFor="title">Titel *</Label><Input id="title" name="title" maxLength={300} value={title} onChange={event => setTitle(event.target.value)} placeholder="Zum Beispiel: Mein Community-Dashboard" required aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? 'title-error' : undefined} />{fieldError('title')}</div>
                    <div className="space-y-2"><p id="description-label" className="text-sm font-medium">Beschreibung *</p><p id="description-help" className="text-xs text-muted-foreground">Mindestens 50 Zeichen.</p><div role="group" aria-labelledby="description-label" aria-describedby={errors.description ? 'description-error description-help' : 'description-help'} className={errors.description ? 'rounded-lg ring-1 ring-destructive' : undefined}><Editor content={description} onChange={setDescription} className="min-h-[220px]" readOnly={isSubmitting} /></div>{fieldError('description')}</div>
                    <div className="space-y-2"><Label htmlFor="category">Kategorie *</Label><Select value={category} onValueChange={setCategory} disabled={isSubmitting}><SelectTrigger id="category" aria-required="true" aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? 'category-error' : undefined}><SelectValue placeholder="Kategorie auswählen" /></SelectTrigger><SelectContent>{CATEGORIES.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>{fieldError('category')}</div>
                    <div className="space-y-2"><Label htmlFor="tags">Tags <span className="font-normal text-muted-foreground">(optional)</span></Label><div className="flex min-w-0 gap-2"><Input id="tags" maxLength={60} value={currentTag} onChange={event => setCurrentTag(event.target.value)} placeholder="Zum Beispiel: React" disabled={isSubmitting || tags.length >= 20} aria-describedby="tags-help" className="min-w-0 flex-1" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); handleAddTag() } }} /><Button type="button" variant="outline" onClick={handleAddTag} disabled={!currentTag.trim() || tags.length >= 20} aria-label="Tag hinzufügen"><Plus className="h-4 w-4" aria-hidden="true" /><span className="ml-1 hidden sm:inline">Hinzufügen</span></Button></div><p id="tags-help" className="text-xs text-muted-foreground">{tags.length}/20 Tags.</p><div className="flex flex-wrap gap-2">{tags.map(tag => <span key={tag} className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-full border bg-muted pl-3 pr-1 text-xs"><span className="min-w-0 break-all">{tag}</span><button type="button" onClick={() => setTags(values => values.filter(value => value !== tag))} aria-label={`Tag ${tag} entfernen`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" aria-hidden="true" /></button></span>)}</div></div>
                    <div className="space-y-2"><Label htmlFor="link">Projekt-Link *</Label><Input id="link" name="link" type="url" inputMode="url" maxLength={2048} value={link} onChange={event => setLink(event.target.value)} placeholder="https://github.com/…" required aria-invalid={Boolean(errors.link)} aria-describedby={errors.link ? 'link-error' : undefined} />{fieldError('link')}</div>
                    <div className="space-y-2"><Label htmlFor="imageUrl">Vorschaubild <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="imageUrl" name="imageUrl" type="url" inputMode="url" maxLength={2048} value={imageUrl} onChange={event => setImageUrl(event.target.value)} placeholder="https://example.com/projekt.jpg" aria-invalid={Boolean(errors.imageUrl)} aria-describedby={errors.imageUrl ? 'imageUrl-error' : undefined} />{fieldError('imageUrl')}{previewUrl && <div className="relative mt-3 flex h-48 w-full items-center justify-center overflow-hidden rounded-xl border bg-muted">{failedImageUrl === previewUrl ? <p role="status" className="flex items-center gap-2 px-4 text-sm text-muted-foreground"><ImageIcon className="h-4 w-4 shrink-0" aria-hidden="true" />Das Vorschaubild konnte nicht geladen werden.</p> : <Image src={previewUrl} alt="Vorschau des Projektbilds" fill sizes="(max-width: 1024px) 100vw, 650px" className="object-cover" onError={() => setFailedImageUrl(previewUrl)} />}</div>}</div>
                  </fieldset>
                  {submitError && <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{submitError}</p>}
                  <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => router.push('/showcases')} disabled={isSubmitting}>Abbrechen</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}{isSubmitting ? 'Projekt wird eingereicht…' : 'Projekt einreichen'}</Button></div>
                </form>
              </div></section>
            </div>
          </div>}
        </main>
      </div>
    </AppShell>
  )
}
