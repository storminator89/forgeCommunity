'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Award, MoreHorizontal, RefreshCw, Search, UserPlus, Users } from 'lucide-react'
import AddUserDialog from './AddUserDialog'
import { EditUserDialog } from './EditUserDialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type Role = 'ADMIN' | 'MODERATOR' | 'USER' | 'INSTRUCTOR'

interface UserSettings {
  emailNotifications: boolean
  pushNotifications: boolean
  theme: 'LIGHT' | 'DARK'
  language: string
}

interface UserStats {
  postsCount?: number
  commentsCount?: number
  likesReceived?: number
  coursesCount?: number
  projectsCount?: number
  endorsementsCount?: number
}

interface User {
  id: string
  name: string | null
  email: string
  role: Role
  createdAt: string
  image?: string | null
  title?: string | null
  contact?: string | null
  lastLogin?: string | null
  isTestAccount?: boolean
  bio?: string | null
  settings?: UserSettings | null
  userSettings?: UserSettings | null
  stats?: UserStats
  badges?: { name: string; awardedAt: string }[]
  skills?: { name: string; level?: number }[]
}

const roleLabels: Record<Role, string> = {
  ADMIN: 'Administration', MODERATOR: 'Moderation', INSTRUCTOR: 'Kursleitung', USER: 'Mitglied',
}

function displayName(user: User) {
  return user.name?.trim() || user.email
}

function formatDate(value?: string | null) {
  if (!value) return 'Nie'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unbekannt' : date.toLocaleDateString('de-DE')
}

function activityLabel(value?: string | null) {
  if (!value) return 'Noch nie angemeldet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unbekannt'
  return `Zuletzt am ${date.toLocaleDateString('de-DE')}`
}

function mergeUser(previous: User, next: User): User {
  return {
    ...previous,
    ...next,
    isTestAccount: previous.isTestAccount ?? next.isTestAccount,
    settings: next.userSettings ?? next.settings ?? previous.settings,
    // The list endpoint only provides names; do not replace detailed skills with them.
    skills: next.skills?.some(skill => skill.level !== undefined) ? next.skills : previous.skills ?? next.skills,
  }
}

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null)
  return new Error(body?.error || body?.message || fallback)
}

function DetailPair({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-1 border-b border-border py-3 last:border-0">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 max-w-full break-words font-medium text-foreground">{value}</dd>
  </div>
}

export default function UserManagement() {
  const { data: session, status } = useSession()
  const router = useRouter()
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/')
  }, [status, router])
  if (status === 'loading') return <div role="status" className="py-16 text-center text-sm text-muted-foreground">Benutzer werden geladen …</div>
  if (status !== 'authenticated' || !session) return null
  if (session.user.role !== 'ADMIN' || !session.user.id) return <p role="alert" className="py-16 text-center text-sm text-destructive">Keine Administratorrechte.</p>
  // A new authenticated account gets a fresh, empty component immediately.
  // No list, detail, dialog or error from the previous account can render.
  return <ScopedUserManagement key={session.user.id} viewerId={session.user.id} />
}

function ScopedUserManagement({ viewerId }: { viewerId: string }) {
  const [users, setUsers] = useState<User[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [isAddUserOpen, setIsAddUserOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<User | null>(null)
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [detailRetry, setDetailRetry] = useState(0)
  const [testAccountPendingId, setTestAccountPendingId] = useState<string | null>(null)
  const [testAccountError, setTestAccountError] = useState<string | null>(null)
  const scopeRef = useRef<string | null>(viewerId)
  const refreshControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => { scopeRef.current = null; refreshControllerRef.current?.abort() }
  }, [])

  const fetchUsers = useCallback(async (signal?: AbortSignal): Promise<User[]> => {
    const response = await fetch('/api/admin/users', { method: 'GET', credentials: 'include', signal })
    if (!response.ok) throw await responseError(response, 'Benutzer konnten nicht geladen werden.')
    return response.json() as Promise<User[]>
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void fetchUsers(controller.signal).then(next => {
      if (!controller.signal.aborted && scopeRef.current === viewerId) {
        setUsers(next)
        setLastLoadedAt(Date.now())
        setListError(null)
        setLoadState('ready')
      }
    }).catch(() => {
      if (!controller.signal.aborted && scopeRef.current === viewerId) {
        setListError('Benutzer konnten nicht geladen werden.')
        setLoadState('error')
      }
    })
    return () => { controller.abort(); refreshControllerRef.current?.abort() }
  }, [fetchUsers, viewerId])

  const refreshUsers = useCallback(async () => {
    if (!viewerId || scopeRef.current !== viewerId || isRefreshing) return
    refreshControllerRef.current?.abort()
    const controller = new AbortController()
    refreshControllerRef.current = controller
    setIsRefreshing(true)
    setListError(null)
    try {
      const next = await fetchUsers(controller.signal)
      if (controller.signal.aborted || scopeRef.current !== viewerId) return
      setUsers(next)
      setLastLoadedAt(Date.now())
      setLoadState('ready')
      setSelectedId(current => current && next.some(user => user.id === current) ? current : null)
    } catch {
      if (controller.signal.aborted || scopeRef.current !== viewerId) return
      setListError('Benutzer konnten nicht geladen werden. Bitte erneut versuchen.')
      if (loadState === 'loading') setLoadState('error')
    } finally {
      if (refreshControllerRef.current === controller) refreshControllerRef.current = null
      if (!controller.signal.aborted && scopeRef.current === viewerId) setIsRefreshing(false)
    }
  }, [fetchUsers, isRefreshing, loadState, viewerId])

  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    void fetch(`/api/admin/users/${encodeURIComponent(selectedId)}`, { credentials: 'include', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw await responseError(response, 'Details konnten nicht geladen werden.')
        return response.json() as Promise<User>
      })
      .then(detail => {
        if (!controller.signal.aborted && scopeRef.current === viewerId) {
          setSelectedDetail(detail)
          setDetailState('ready')
        }
      }).catch(() => {
        if (!controller.signal.aborted && scopeRef.current === viewerId) setDetailState('error')
      })
    return () => controller.abort()
  }, [selectedId, detailRetry, viewerId])

  const selectedRow = users.find(user => user.id === selectedId) ?? null
  const selectedUser = selectedRow && selectedDetail ? mergeUser(selectedRow, selectedDetail) : selectedRow
  const selectUser = (user: User) => {
    if (!viewerId || scopeRef.current !== viewerId) return
    if (selectedId === user.id) return
    setSelectedId(user.id)
    setSelectedDetail(null)
    setDetailState('loading')
    setTestAccountError(null)
  }
  const filteredUsers = users.filter(user => {
    const query = searchTerm.trim().toLocaleLowerCase('de-DE')
    return [user.name, user.email, user.role, user.title].some(value => value?.toLocaleLowerCase('de-DE').includes(query))
  })

  const handleAddUser = (newUser: User) => {
    if (!viewerId || scopeRef.current !== viewerId) return
    setUsers(current => [...current, newUser])
    setIsAddUserOpen(false)
    void refreshUsers()
  }

  const handleEditUser = async (user: User) => {
    if (!viewerId || scopeRef.current !== viewerId) return
    setActionError(null)
    if (selectedDetail?.id === user.id) {
      setEditingUser(mergeUser(user, selectedDetail))
      return
    }
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { credentials: 'include' })
      if (scopeRef.current !== viewerId) return
      if (!response.ok) throw await responseError(response, 'Benutzer konnte nicht geladen werden.')
      const detail = await response.json() as User
      if (scopeRef.current === viewerId) setEditingUser(mergeUser(user, detail))
    } catch {
      if (scopeRef.current === viewerId) setActionError(`Die Daten von ${displayName(user)} konnten nicht zum Bearbeiten geladen werden.`)
    }
  }

  const handleUpdateUser = (updated: User) => {
    if (!viewerId || scopeRef.current !== viewerId) return
    setUsers(current => current.map(user => user.id === updated.id ? mergeUser(user, updated) : user))
    setSelectedDetail(current => current?.id === updated.id ? mergeUser(current, updated) : current)
    setEditingUser(null)
    void refreshUsers()
  }

  const handleDeleteUser = async (user: User) => {
    if (!viewerId || scopeRef.current !== viewerId) return
    if (!window.confirm(`„${displayName(user)}“ wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden. Falls andere Mitglieder Zertifikate für Kurse dieses Kontos besitzen, wird die Löschung zum Schutz ihrer Nachweise abgelehnt.`)) return
    if (scopeRef.current !== viewerId) return
    setActionError(null)
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' })
      if (scopeRef.current !== viewerId) return
      if (!response.ok) throw await responseError(response, 'Benutzer konnte nicht gelöscht werden.')
      setUsers(current => current.filter(item => item.id !== user.id))
      if (selectedId === user.id) setSelectedId(null)
    } catch (error) {
      if (scopeRef.current === viewerId) setActionError(error instanceof Error ? error.message : 'Benutzer konnte nicht gelöscht werden.')
    }
  }

  const updateTestAccount = async (user: User, isTestAccount: boolean) => {
    if (!viewerId || scopeRef.current !== viewerId) return
    setTestAccountPendingId(user.id)
    setTestAccountError(null)
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/test-account`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isTestAccount }),
      })
      if (scopeRef.current !== viewerId) return
      if (!response.ok) throw await responseError(response, 'Der Testkonto-Status konnte nicht geändert werden.')
      const result = await response.json() as { isTestAccount: boolean }
      setUsers(current => current.map(item => item.id === user.id ? { ...item, isTestAccount: result.isTestAccount } : item))
      setSelectedDetail(current => current?.id === user.id ? { ...current, isTestAccount: result.isTestAccount } : current)
    } catch (error) {
      if (scopeRef.current === viewerId) setTestAccountError(error instanceof Error ? error.message : 'Der Testkonto-Status konnte nicht geändert werden.')
    } finally {
      if (scopeRef.current === viewerId) setTestAccountPendingId(null)
    }
  }

  if (loadState === 'loading') {
    return <div role="status" className="py-16 text-center text-sm text-muted-foreground">Benutzer werden geladen …</div>
  }

  return <div className="min-w-0 space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div className="min-w-0">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Administration / Mitglieder</p>
        <h1 className="flex items-center gap-3 text-[clamp(1.65rem,1.1rem+2vw,2.35rem)] font-semibold tracking-tight text-foreground">
          <Users aria-hidden="true" className="h-6 w-6 shrink-0 text-primary" /> Benutzerverwaltung
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Konten, Rollen und Aktivitäten an einem Ort verwalten.</p>
      </div>
      <Button className="shrink-0" onClick={() => setIsAddUserOpen(true)}><UserPlus aria-hidden="true" className="mr-2 h-4 w-4" />Neuer Benutzer</Button>
    </header>

    <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,23rem)]">
      <section aria-labelledby="users-heading" className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="users-heading" className="text-xl font-semibold text-foreground">Benutzer</h2>
            <p role="status" className="text-sm text-muted-foreground">{filteredUsers.length} von {users.length} Konten</p></div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
            <div className="relative min-w-0 flex-1 sm:w-72">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" aria-label="Benutzer suchen" placeholder="Name, E-Mail, Rolle …" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} className="pl-9" />
            </div>
            <Button variant="outline" onClick={() => void refreshUsers()} disabled={isRefreshing} className="shrink-0">
              <RefreshCw aria-hidden="true" className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />{isRefreshing ? 'Wird geladen' : 'Aktualisieren'}
            </Button>
          </div>
        </div>
        {listError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
          <span>{listError}</span><Button variant="outline" size="sm" onClick={() => void refreshUsers()}>Erneut versuchen</Button>
        </div>}
        {actionError && <p role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">{actionError}</p>}
        {loadState === 'ready' && (filteredUsers.length ?
          <div className="min-w-0 space-y-2">
            <p id="users-table-scroll-hint" className="text-xs text-muted-foreground 2xl:hidden">Weitere Spalten: Tabelle seitlich wischen oder mit den Pfeiltasten scrollen →</p>
            <div role="region" aria-label="Benutzerliste, horizontal verschiebbar" aria-describedby="users-table-scroll-hint" tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border border-border bg-card focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
            <table className="w-full min-w-[690px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><tr>
                <th scope="col" className="px-4 py-3">Benutzer</th><th scope="col" className="px-4 py-3">Kontakt</th>
                <th scope="col" className="px-4 py-3">Rolle</th><th scope="col" className="px-4 py-3">Aktivität</th>
                <th scope="col" className="px-4 py-3 text-right">Aktionen</th>
              </tr></thead>
              <tbody className="divide-y divide-border">{filteredUsers.map(user => <tr key={user.id} className="hover:bg-muted/40 data-[state=selected]:bg-accent/50" data-state={selectedId === user.id ? 'selected' : undefined}>
                <td className="px-4 py-3"><div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-9 w-9 shrink-0"><AvatarImage src={user.image || ''} alt="" /><AvatarFallback>{displayName(user).slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                  <div className="min-w-0"><button type="button" aria-pressed={selectedId === user.id} onClick={() => selectUser(user)} className="max-w-48 break-words rounded-[0.25rem] text-left font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Details von ${displayName(user)} öffnen`}>{displayName(user)}</button>
                    {user.title && <p className="max-w-48 break-words text-xs text-muted-foreground">{user.title}</p>}</div>
                </div></td>
                <td className="max-w-56 break-all px-4 py-3 text-muted-foreground">{user.email}{user.contact && <p className="mt-1 break-words text-xs">{user.contact}</p>}</td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-1"><Badge variant={user.role === 'ADMIN' ? 'secondary' : 'outline'}>{roleLabels[user.role] ?? user.role}</Badge>{user.isTestAccount && <Badge variant="outline">Testkonto</Badge>}</div></td>
                <td className="px-4 py-3 text-muted-foreground"><span className="block">{activityLabel(user.lastLogin)}</span><span className="mt-1 block text-xs">Seit {formatDate(user.createdAt)}</span></td>
                <td className="px-4 py-3 text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Aktionen für ${displayName(user)}`} className="h-11 w-11"><MoreHorizontal aria-hidden="true" className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end"><DropdownMenuLabel>{displayName(user)}</DropdownMenuLabel><DropdownMenuItem onSelect={() => void handleEditUser(user)}>Bearbeiten</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void handleDeleteUser(user)}>Löschen</DropdownMenuItem></DropdownMenuContent>
                </DropdownMenu></td>
              </tr>)}</tbody>
            </table>
            </div>
          </div>
          : <div className="rounded-xl border border-dashed border-border p-8 text-center"><p className="font-medium text-foreground">{searchTerm ? 'Keine Treffer' : 'Noch keine Benutzer'}</p><p className="mt-1 text-sm text-muted-foreground">{searchTerm ? 'Versuchen Sie einen anderen Suchbegriff.' : 'Erstellen Sie das erste Konto, um es hier zu verwalten.'}</p>{searchTerm && <Button variant="outline" size="sm" className="mt-4" onClick={() => setSearchTerm('')}>Suche zurücksetzen</Button>}</div>)}
      </section>

      <aside aria-label={selectedUser ? `Details zu ${displayName(selectedUser)}` : 'Benutzerstatistiken'} className="min-w-0 xl:border-l xl:border-border xl:pl-8">
        {selectedUser ? <div className="min-w-0 space-y-5">
          <div className="flex min-w-0 items-center gap-3 border-b border-border pb-4"><Avatar className="h-12 w-12 shrink-0"><AvatarImage src={selectedUser.image || ''} alt="" /><AvatarFallback>{displayName(selectedUser).slice(0, 2).toUpperCase()}</AvatarFallback></Avatar><div className="min-w-0"><h2 className="break-words text-lg font-semibold">{displayName(selectedUser)}</h2><p className="break-all text-sm text-muted-foreground">{selectedUser.email}</p></div></div>
          <div className="rounded-xl border border-border bg-card p-4"><div className="flex items-start justify-between gap-4"><div className="space-y-1"><Label htmlFor={`test-account-${selectedUser.id}`}>Testkonto</Label><p id={`test-account-description-${selectedUser.id}`} className="text-sm text-muted-foreground">Testkonten können keine Punkte oder Kursbelohnungen verdienen und erscheinen nicht in der Rangliste.</p></div><Switch id={`test-account-${selectedUser.id}`} aria-describedby={`test-account-description-${selectedUser.id}`} checked={selectedUser.isTestAccount === true} disabled={testAccountPendingId === selectedUser.id} onCheckedChange={checked => void updateTestAccount(selectedUser, checked)} /></div>{testAccountError && <p role="alert" className="mt-2 text-sm text-destructive">{testAccountError}</p>}</div>
          {detailState === 'loading' && <p role="status" className="text-sm text-muted-foreground">Weitere Details werden geladen …</p>}
          {detailState === 'error' && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>Weitere Details konnten nicht geladen werden.</span><Button size="sm" variant="outline" onClick={() => { setDetailState('loading'); setDetailRetry(current => current + 1) }}>Erneut versuchen</Button></div>}
          <Tabs defaultValue="overview" key={selectedUser.id} className="min-w-0"><TabsList className="flex h-auto w-full justify-start overflow-x-auto"><TabsTrigger value="overview">Übersicht</TabsTrigger><TabsTrigger value="activity">Aktivität</TabsTrigger><TabsTrigger value="skills">Skills</TabsTrigger><TabsTrigger value="settings">Einstellungen</TabsTrigger></TabsList>
            <TabsContent value="overview"><dl className="text-sm"><DetailPair label="Rolle" value={roleLabels[selectedUser.role] ?? selectedUser.role} /><DetailPair label="Mitglied seit" value={formatDate(selectedUser.createdAt)} /><DetailPair label="Letzter Login" value={formatDate(selectedUser.lastLogin)} />{selectedUser.title && <DetailPair label="Position" value={selectedUser.title} />}{selectedUser.contact && <DetailPair label="Kontakt" value={selectedUser.contact} />}</dl>{selectedUser.bio && <div className="mt-4"><h3 className="font-medium">Biografie</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{selectedUser.bio}</p></div>}{!!selectedUser.badges?.length && <div className="mt-4"><h3 className="font-medium">Errungenschaften</h3><div className="mt-2 flex flex-wrap gap-2">{selectedUser.badges.map((badge, index) => <Badge key={`${badge.name}-${index}`} variant="outline"><Award aria-hidden="true" className="mr-1 h-3 w-3" />{badge.name}</Badge>)}</div></div>}</TabsContent>
            <TabsContent value="activity">{selectedUser.stats?.postsCount !== undefined ? <dl className="text-sm"><DetailPair label="Beiträge" value={selectedUser.stats.postsCount} /><DetailPair label="Kommentare" value={selectedUser.stats.commentsCount ?? 0} /><DetailPair label="Likes erhalten" value={selectedUser.stats.likesReceived ?? 0} /><DetailPair label="Endorsements" value={selectedUser.stats.endorsementsCount ?? 0} /><DetailPair label="Kurse" value={selectedUser.stats.coursesCount ?? 0} /><DetailPair label="Projekte" value={selectedUser.stats.projectsCount ?? 0} /></dl> : <p className="py-5 text-sm text-muted-foreground">{detailState === 'loading' ? 'Aktivität wird geladen …' : 'Keine Aktivitätsdaten verfügbar.'}</p>}</TabsContent>
            <TabsContent value="skills">{selectedUser.skills?.length ? <ul className="divide-y divide-border">{selectedUser.skills.map((skill, index) => <li key={`${skill.name}-${index}`} className="flex justify-between gap-4 py-3 text-sm"><span className="break-words">{skill.name}</span>{skill.level !== undefined && <span className="text-muted-foreground">{skill.level}%</span>}</li>)}</ul> : <p className="py-5 text-sm text-muted-foreground">Keine Fähigkeiten angegeben.</p>}</TabsContent>
            <TabsContent value="settings">{selectedUser.settings ? <dl className="text-sm"><DetailPair label="E-Mail-Wunsch (kein Versand)" value={selectedUser.settings.emailNotifications ? 'Aktiviert' : 'Deaktiviert'} /><DetailPair label="Desktop-Hinweise für Chat (App geöffnet)" value={selectedUser.settings.pushNotifications ? 'Aktiviert' : 'Deaktiviert'} /><DetailPair label="Theme" value={selectedUser.settings.theme === 'DARK' ? 'Dunkel' : 'Hell'} /><DetailPair label="Sprache" value={selectedUser.settings.language.toUpperCase()} /></dl> : <p className="py-5 text-sm text-muted-foreground">{detailState === 'loading' ? 'Einstellungen werden geladen …' : 'Keine Einstellungen verfügbar.'}</p>}</TabsContent>
          </Tabs>
        </div> : loadState === 'ready' ? <div><h2 className="border-b border-border pb-4 text-lg font-semibold">Benutzerstatistiken</h2><dl className="text-sm"><DetailPair label="Gesamt" value={users.length} /><DetailPair label="Administration" value={users.filter(user => user.role === 'ADMIN').length} /><DetailPair label="Moderation" value={users.filter(user => user.role === 'MODERATOR').length} /><DetailPair label="Kursleitung" value={users.filter(user => user.role === 'INSTRUCTOR').length} /><DetailPair label="Mitglieder" value={users.filter(user => user.role === 'USER').length} /><DetailPair label="Aktiv in 30 Tagen" value={users.filter(user => user.lastLogin && lastLoadedAt && new Date(user.lastLogin).getTime() > lastLoadedAt - 30 * 86400000).length} /></dl></div> : <p className="text-sm text-muted-foreground">Statistiken sind derzeit nicht verfügbar.</p>}
      </aside>
    </div>
    <AddUserDialog isOpen={isAddUserOpen} onClose={() => setIsAddUserOpen(false)} onAddUser={handleAddUser} />
    <EditUserDialog user={editingUser} isOpen={!!editingUser} onClose={() => setEditingUser(null)} onUpdateUser={handleUpdateUser} />
  </div>
}
