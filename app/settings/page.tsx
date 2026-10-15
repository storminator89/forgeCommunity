"use client"

import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { Sidebar } from "@/components/Sidebar"
import { UserNav } from "@/components/user-nav"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bell, CheckCircle, XCircle, Code, Database, Languages, Edit, Trash, Award, ExternalLink, Linkedin, Eye, Download, Layout } from 'lucide-react'
import { ImageUpload } from "@/components/ImageUpload"
import axios from 'axios'
import { toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageState } from '@/components/page-state'
import { publishBrowserChatAlertPreference } from '@/lib/browser-chat-alerts'

interface Skill {
  id: string
  name: string
  category: string
}

interface UserSkill {
  id: string
  userId: string
  skillId: string
  level: number
  endorsements: number
  skill: Skill
}

interface Certificate {
  id: string
  courseId: string
  courseName: string
  issuedAt: string
  userId: string
  userName: string
}

const SKILL_LEVELS = [
  { label: 'Keine Kenntnisse', value: 0, color: 'bg-secondary' },
  { label: 'Beginner', value: 33, color: 'bg-primary' },
  { label: 'Fortgeschritten', value: 66, color: 'bg-primary' },
  { label: 'Experte', value: 100, color: 'bg-primary' }
] as const;

// Hilfsfunktion um den nächstgelegenen Level zu finden
const findNearestLevel = (value: number) => {
  return SKILL_LEVELS.reduce((prev, curr) => {
    return Math.abs(curr.value - value) < Math.abs(prev.value - value) ? curr : prev;
  });
};

// Hilfsfunktion um den Label für einen Wert zu bekommen
const getLevelLabel = (value: number) => {
  return findNearestLevel(value).label;
};


export default function SettingsPage() {
  const { data: session, status } = useSession()
  const userId = status === 'authenticated' ? session?.user?.id : null

  // Remount every private state field on an account transition, including
  // Alice -> Bob without a route change and logout before a redirect occurs.
  if (!userId) return <div className="mx-auto max-w-lg px-4 py-12"><PageState
    kind={status === 'loading' ? 'loading' : 'empty'}
    title={status === 'loading' ? 'Einstellungen werden geladen' : 'Anmeldung erforderlich'}
  /></div>

  return <AccountSettings key={userId} userId={userId} />
}

function AccountSettings({ userId }: { userId: string }) {
  const actionController = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    actionController.current = controller
    return () => controller.abort()
  }, [userId])
  // Grundlegende Benutzerinformationen
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [userImage, setUserImage] = useState<string | null>(null)
  const [language, setLanguage] = useState('de')
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [pushNotifications, setPushNotifications] = useState(true)
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | 'checking' | 'unsupported'>('checking')
  const [permissionError, setPermissionError] = useState('')
  const [publicRankingOptIn, setPublicRankingOptIn] = useState(false)

  // Fähigkeiten-Verwaltung
  const [userSkills, setUserSkills] = useState<UserSkill[]>([])
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([])
  const [newSkillId, setNewSkillId] = useState<string>('')
  const [newSkillLevel, setNewSkillLevel] = useState<number>(0)
  const [newSkillName, setNewSkillName] = useState<string>('')

  // Zertifikate-Verwaltung
  const [certificates, setCertificates] = useState<Certificate[]>([])

  // Modale Zustände
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editSkill, setEditSkill] = useState<UserSkill | null>(null)

  // Lade- und Fehlerzustände
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  useEffect(() => {
    const refreshPermission = () => {
      setBrowserPermission('Notification' in window && typeof Notification.requestPermission === 'function'
        ? Notification.permission : 'unsupported')
    }
    refreshPermission()
    window.addEventListener('focus', refreshPermission)
    return () => window.removeEventListener('focus', refreshPermission)
  }, [])

  const requestBrowserPermission = async () => {
    if (!('Notification' in window) || typeof Notification.requestPermission !== 'function') {
      setBrowserPermission('unsupported')
      return
    }
    setPermissionError('')
    try {
      // Only a direct button click may open the browser's permission prompt.
      setBrowserPermission(await Notification.requestPermission())
    } catch {
      setPermissionError('Die Browserberechtigung konnte nicht angefragt werden.')
      setBrowserPermission(Notification.permission)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    const fetchData = async () => {
      setIsLoading(true)
      try {
        const [skillsResponse, userSkillsResponse, userResponse, certificatesResponse] = await Promise.all([
          axios.get('/api/skills', { signal: controller.signal }),
          axios.get('/api/user/skills', { signal: controller.signal }),
          axios.get('/api/user/profile', { signal: controller.signal }),
          axios.get('/api/user/certificates', { signal: controller.signal })
        ])
        if (controller.signal.aborted) return
        if (userResponse.data?.id !== userId) throw new Error('Das Profil gehört nicht zum angemeldeten Konto.')
        setAvailableSkills(skillsResponse.data)
        setUserSkills(userSkillsResponse.data)
        setUserImage(userResponse.data.image)
        setName(userResponse.data.name || '')
        setEmail(userResponse.data.email || '')
        // The profile endpoint returns preferences under `userSettings`.
        // Hydrate these controls so saving one tab does not overwrite values
        // that were already persisted for the account.
        const userSettings = userResponse.data.userSettings
        setLanguage(userSettings?.language || 'de')
        setEmailNotifications(userSettings?.emailNotifications ?? true)
        setPushNotifications(userSettings?.pushNotifications ?? true)
        publishBrowserChatAlertPreference({ userId, enabled: userSettings?.pushNotifications ?? true })
        setPublicRankingOptIn(userSettings?.publicRankingOptIn === true)
        setCertificates(certificatesResponse.data)
        setIsLoaded(true)
      } catch (error) {
        if (controller.signal.aborted) return
        console.error("Fehler beim Abrufen der Daten:", error)
        setLoadError("Die Einstellungen konnten nicht geladen werden. Bitte lade die Seite erneut.")
        toast.error("Beim Laden der Daten ist ein Fehler aufgetreten.")
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    void fetchData()
    return () => controller.abort()
  }, [userId])

  const handleImageUpdate = async (newImageUrl: string) => {
    setUserImage(newImageUrl)
    try {
      await axios.put('/api/user/profile', { image: newImageUrl }, { signal: actionController.current?.signal })
    } catch (error) {
      if (actionController.current?.signal.aborted) return
      console.error("Fehler beim Aktualisieren des Profilbilds:", error)
      toast.error("Fehler beim Aktualisieren des Profilbilds")
    }
  }

  const handleSave = async () => {
    if (!isLoaded || isLoading || isSaving) return
    setIsSaving(true)
    try {
      const response = await axios.put('/api/user/profile', {
        name,
        email,
        language,
        emailNotifications,
        pushNotifications,
        publicRankingOptIn
      }, { signal: actionController.current?.signal })
      if (actionController.current?.signal.aborted) return
      if (response.data?.id !== userId) throw new Error('Das gespeicherte Profil gehört nicht zum angemeldeten Konto.')
      const savedPreference = response.data?.userSettings?.pushNotifications
      if (typeof savedPreference === 'boolean') {
        publishBrowserChatAlertPreference({ userId, enabled: savedPreference })
      }
      toast.success("Einstellungen erfolgreich gespeichert.")
    } catch (error) {
      if (actionController.current?.signal.aborted) return
      console.error("Fehler beim Speichern der Einstellungen:", error)
      toast.error("Beim Speichern der Einstellungen ist ein Fehler aufgetreten.")
    } finally {
      if (!actionController.current?.signal.aborted) setIsSaving(false)
    }
  }

  const handleAddSkill = async () => {
    try {
      let skillId = newSkillId

      if (newSkillId === 'new') {
        if (!newSkillName.trim()) {
          toast.error("Der Name der neuen Fähigkeit darf nicht leer sein.")
          return
        }

        const createSkillResponse = await axios.post('/api/skills', {
          name: newSkillName.trim(),
          category: 'Unkategorisiert'
        }, { signal: actionController.current?.signal })
        if (actionController.current?.signal.aborted) return
        skillId = createSkillResponse.data.id
      }

      if (!skillId) {
        toast.error("Bitte wähle eine gültige Fähigkeit aus.")
        return
      }

      if (newSkillLevel < 0 || newSkillLevel > 100) {
        toast.error("Das Fähigkeitslevel muss zwischen 0 und 100 liegen.")
        return
      }

      await axios.post('/api/user/skills', { skillId, level: newSkillLevel }, { signal: actionController.current?.signal })
      if (actionController.current?.signal.aborted) return
      const response = await axios.get('/api/user/skills', { signal: actionController.current?.signal })
      if (actionController.current?.signal.aborted) return
      setUserSkills(response.data)
      toast.success("Fähigkeit erfolgreich hinzugefügt.")
      setNewSkillId('')
      setNewSkillLevel(0)
      setNewSkillName('')
    } catch (error: any) {
      if (actionController.current?.signal.aborted) return
      console.error("Fehler beim Hinzufügen der Fähigkeit:", error)
      toast.error(error.response?.data?.error || "Fehler beim Hinzufügen der Fähigkeit.")
    }
  }

  const handleDeleteSkill = async (skillId: string) => {
    try {
      await axios.delete(`/api/user/skills/${skillId}`, { signal: actionController.current?.signal })
      if (actionController.current?.signal.aborted) return
      const response = await axios.get('/api/user/skills', { signal: actionController.current?.signal })
      if (actionController.current?.signal.aborted) return
      setUserSkills(response.data)
      toast.success("Fähigkeit erfolgreich gelöscht.")
    } catch (error: any) {
      if (actionController.current?.signal.aborted) return
      console.error("Fehler beim Löschen der Fähigkeit:", error)
      toast.error(error.response?.data?.error || "Fehler beim Löschen der Fähigkeit.")
    }
  }

  const handleEditSkill = async () => {
    if (!editSkill) return

    try {
      if (editSkill.level < 0 || editSkill.level > 100) {
        toast.error("Das Fähigkeitslevel muss zwischen 0 und 100 liegen.")
        return
      }

      await axios.put(`/api/user/skills/${editSkill.skillId}`, { level: editSkill.level }, { signal: actionController.current?.signal })
      if (actionController.current?.signal.aborted) return
      const response = await axios.get('/api/user/skills', { signal: actionController.current?.signal })
      if (actionController.current?.signal.aborted) return
      setUserSkills(response.data)
      toast.success("Fähigkeit erfolgreich aktualisiert.")
      setIsEditModalOpen(false)
      setEditSkill(null)
    } catch (error: any) {
      if (actionController.current?.signal.aborted) return
      console.error("Fehler beim Aktualisieren der Fähigkeit:", error)
      toast.error(error.response?.data?.error || "Fehler beim Aktualisieren der Fähigkeit.")
    }
  }

  const getSkillIcon = (skillName: string) => {
    const name = skillName.toLowerCase()
    if (name.includes('javascript') || name.includes('typescript') || name.includes('python')) {
      return <Code className="w-5 h-5 text-primary" />
    } else if (name.includes('design') || name.includes('ui') || name.includes('ux')) {
      return <Layout className="w-5 h-5 text-primary" />
    } else if (name.includes('database') || name.includes('sql') || name.includes('mongodb')) {
      return <Database className="w-5 h-5 text-primary" />
    } else if (name.includes('language') || name.includes('german') || name.includes('english')) {
      return <Languages className="w-5 h-5 text-primary" />
    }
    return <CheckCircle className="w-5 h-5 text-muted-foreground" />
  }

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader>
          <div className="flex min-w-0 items-center justify-between gap-3">
            <h1>Einstellungen</h1>
            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>

        <main id="page-content" tabIndex={-1} aria-busy={isLoading} className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="mx-auto max-w-4xl space-y-6">
            <div className="border-b pb-6"><h2 className="text-xl font-semibold tracking-tight">Dein Konto verwalten</h2><p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">Profil, Benachrichtigungen, Privatsphäre und deine eigenen Nachweise an einem Ort.</p></div>
            {isLoading ? <PageState kind="loading" title="Einstellungen werden geladen" description="Deine gespeicherten Angaben werden vorbereitet." /> : loadError ? <PageState kind="error" title="Einstellungen konnten nicht geladen werden" description={loadError} action={<Button variant="outline" onClick={() => window.location.reload()}>Erneut laden</Button>} /> : (
            <Tabs defaultValue="account" className="w-full">
              <TabsList className="mb-6 grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-3 lg:grid-cols-5">
                <TabsTrigger value="account" className="min-h-11 min-w-0 px-2">Konto</TabsTrigger>
                <TabsTrigger value="notifications" className="min-h-11 min-w-0 px-2">Meldungen</TabsTrigger>
                <TabsTrigger value="privacy" className="min-h-11 min-w-0 px-2">Privatsphäre</TabsTrigger>
                <TabsTrigger value="skills" className="min-h-11 min-w-0 px-2">Fähigkeiten</TabsTrigger>
                <TabsTrigger value="certificates" className="min-h-11 min-w-0 px-2">Zertifikate</TabsTrigger>
              </TabsList>

              {/* Konto-Tab */}
              <TabsContent value="account">
                <Card>
                  <CardHeader>
                    <CardTitle>Kontoinformationen</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ImageUpload
                      currentImage={userImage}
                      onImageUpdate={handleImageUpdate}
                    />
                    <div className="space-y-2">
                      <Label htmlFor="name">Name</Label>
                      <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">E-Mail</Label>
                      <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="language">Sprache</Label>
                      <Select value={language} onValueChange={setLanguage}>
                        <SelectTrigger id="language">
                          <SelectValue placeholder="Sprache auswählen" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="de">Deutsch</SelectItem>
                          <SelectItem value="en">Englisch</SelectItem>
                          <SelectItem value="fr">Französisch</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button onClick={handleSave} disabled={!isLoaded || isLoading || isSaving}>{isSaving ? 'Wird gespeichert…' : 'Speichern'}</Button>
                  </CardFooter>
                </Card>
              </TabsContent>

              {/* Benachrichtigungen-Tab */}
              <TabsContent value="notifications">
                <Card>
                  <CardHeader>
                    <CardTitle>Benachrichtigungseinstellungen</CardTitle>
                    <CardDescription>Meldungen in der App sind von diesen Schaltern unabhängig. Wenn diese App im Browser geöffnet ist, können zusätzlich Desktop-Hinweise für neue Chatnachrichten erscheinen. E-Mails und Hintergrund-Push werden derzeit nicht versendet.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center space-x-2">
                        <Bell className="w-5 h-5 text-muted-foreground" />
                        <Label htmlFor="email-notifications">E-Mail-Wunsch für später (kein Versand)</Label>
                      </div>
                      <Switch
                        id="email-notifications"
                        checked={emailNotifications}
                        onCheckedChange={setEmailNotifications}
                        disabled={isSaving}
                        className="relative before:absolute before:-inset-y-3 before:inset-x-0"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center space-x-2">
                        <Bell className="w-5 h-5 text-muted-foreground" />
                        <Label htmlFor="push-notifications">Desktop-Hinweise für Chatnachrichten</Label>
                      </div>
                      <Switch
                        id="push-notifications"
                        checked={pushNotifications}
                        onCheckedChange={setPushNotifications}
                        disabled={isSaving}
                        aria-describedby="browser-chat-alert-description"
                        className="relative before:absolute before:-inset-y-3 before:inset-x-0"
                      />
                    </div>
                    <p id="browser-chat-alert-description" className="text-sm text-muted-foreground">Nur wenn diese App geöffnet, der Tab nicht aktiv und die Browserberechtigung erteilt ist. Änderungen am Schalter werden mit „Speichern“ übernommen. Meldungen in der App bleiben davon unabhängig.</p>
                    <div className="space-y-2 border-t pt-4">
                      <p className="text-sm font-medium">Browserberechtigung</p>
                      {browserPermission === 'checking' && <p role="status" className="text-sm text-muted-foreground">Browserberechtigung wird geprüft…</p>}
                      {browserPermission === 'unsupported' && <p role="status" className="text-sm text-muted-foreground">Dieser Browser unterstützt keine Desktop-Hinweise.</p>}
                      {browserPermission === 'denied' && <p role="status" className="text-sm text-muted-foreground">Desktop-Hinweise sind im Browser blockiert. Du kannst die Berechtigung in den Browser-Einstellungen ändern.</p>}
                      {browserPermission === 'granted' && <p role="status" className="text-sm text-muted-foreground">Desktop-Hinweise sind im Browser erlaubt.</p>}
                      {browserPermission === 'default' && <Button type="button" variant="outline" onClick={() => void requestBrowserPermission()} disabled={!pushNotifications}>Browser-Hinweise erlauben</Button>}
                      {permissionError && <p role="alert" className="text-sm text-destructive">{permissionError}</p>}
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button onClick={handleSave} disabled={!isLoaded || isLoading || isSaving}>{isSaving ? 'Wird gespeichert…' : 'Speichern'}</Button>
                  </CardFooter>
                </Card>
              </TabsContent>

              {/* Privatsphäre-Tab */}
              <TabsContent value="privacy">
                <Card>
                  <CardHeader>
                    <CardTitle>Privatsphäre-Einstellungen</CardTitle>
                    <CardDescription>Du entscheidest, ob dein Name und deine Punkte in der öffentlichen Rangliste erscheinen.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <Label htmlFor="public-ranking-opt-in">In der öffentlichen Rangliste erscheinen</Label>
                        <p id="ranking-consent-description" className="text-sm text-muted-foreground">Standardmäßig aus. Wenn du zustimmst, können andere deinen Namen, dein Profilbild und deine Punkte in der Rangliste sehen. Deine Punkte und Meilensteine bleiben auch ohne Zustimmung für dich sichtbar. Punkte gibt es für von Admins freigegebene Kurse mit gespeichertem gültigem Quiz und bestandenem Versuch für die aktuelle Kursversion. Du kannst die Zustimmung jederzeit zurücknehmen.</p>
                      </div>
                      <Switch id="public-ranking-opt-in" aria-describedby="ranking-consent-description" checked={publicRankingOptIn} onCheckedChange={setPublicRankingOptIn} disabled={!isLoaded || isLoading || isSaving} className="relative before:absolute before:-inset-y-3 before:inset-x-0" />
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button onClick={handleSave} disabled={!isLoaded || isLoading || isSaving}>{isSaving ? 'Wird gespeichert…' : 'Speichern'}</Button>
                  </CardFooter>
                </Card>
              </TabsContent>

              {/* Fähigkeiten-Tab */}
              <TabsContent value="skills">
                <div className="space-y-6">
                  {/* Liste der bestehenden Fähigkeiten */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Fähigkeiten</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {isLoading ? (
                        <p className="text-muted-foreground">Lade Fähigkeiten...</p>
                      ) : (
                        <ul className="divide-y divide-border">
                          {userSkills.length === 0 && <li className="py-5 text-sm text-muted-foreground">Du hast noch keine Fähigkeiten hinzugefügt.</li>}
                          {userSkills.map((userSkill) => (
                            <li key={userSkill.id} className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex min-w-0 items-center gap-4">
                                {getSkillIcon(userSkill.skill?.name || "")}
                                <div className="min-w-0 flex-1">
                                  <span className="break-words font-medium text-foreground">
                                    {userSkill.skill?.name || "Unbekannte Fähigkeit"}
                                  </span>
                                  <div className="mt-2">
                                    <div className="mb-1 flex items-center justify-between gap-2">
                                      <span className="text-sm text-muted-foreground">
                                        {getLevelLabel(userSkill.level)}
                                      </span>
                                      <span className="text-sm tabular-nums text-muted-foreground">{userSkill.level}%</span>
                                    </div>
                                    <div className="h-2.5 w-full min-w-0 rounded-full bg-muted sm:w-48" role="progressbar" aria-label={`Kenntnisstand ${userSkill.skill?.name || 'Unbekannte Fähigkeit'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, userSkill.level))}>
                                      <div
                                        className={`h-2.5 rounded-full ${findNearestLevel(userSkill.level).color}`}
                                        style={{ width: `${Math.max(0, Math.min(100, userSkill.level))}%` }}
                                      ></div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-foreground hover:bg-accent"
                                  onClick={() => {
                                    setEditSkill(userSkill)
                                    setIsEditModalOpen(true)
                                  }}
                                  aria-label={`${userSkill.skill?.name || 'Fähigkeit'} bearbeiten`}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-foreground hover:bg-accent"
                                  onClick={() => handleDeleteSkill(userSkill.skillId)}
                                  aria-label={`${userSkill.skill?.name || 'Fähigkeit'} löschen`}
                                >
                                  <Trash className="w-4 h-4" />
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>

                  {/* Karte zum Hinzufügen einer neuen Fähigkeit */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Neue Fähigkeit hinzufügen</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <Label htmlFor="new-skill">Fähigkeit</Label>
                        <Select value={newSkillId} onValueChange={setNewSkillId}>
                          <SelectTrigger id="new-skill">
                            <SelectValue placeholder="Fähigkeit auswählen oder neue erstellen" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableSkills.map((skill) => (
                              <SelectItem key={skill.id} value={skill.id}>
                                {skill.name}
                              </SelectItem>
                            ))}
                            <SelectItem value="new">Neue Fähigkeit erstellen</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {newSkillId === 'new' && (
                        <div>
                          <Label htmlFor="new-skill-name">Neuer Fähigkeitsname</Label>
                          <Input
                            id="new-skill-name"
                            type="text"
                            placeholder="Neue Fähigkeit"
                            value={newSkillName}
                            onChange={(e) => setNewSkillName(e.target.value)}
                          />
                        </div>
                      )}
                      <div>
                        <Label htmlFor="new-skill-level">Kenntnisstand</Label>
                        <Select
                          value={String(newSkillLevel)}
                          onValueChange={(value) => setNewSkillLevel(Number(value))}
                        >
                          <SelectTrigger id="new-skill-level">
                            <SelectValue placeholder="Kenntnisstand auswählen" />
                          </SelectTrigger>
                          <SelectContent>
                            {SKILL_LEVELS.map((level) => (
                              <SelectItem key={level.value} value={String(level.value)}>
                                {level.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button onClick={handleAddSkill}>Hinzufügen</Button>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* Zertifikate-Tab */}
              <TabsContent value="certificates" className="space-y-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-center space-x-2">
                      <Award className="w-6 h-6 text-primary" />
                      <CardTitle>Meine Zertifikate</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {certificates.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground">
                        <Award className="w-12 h-12 mx-auto mb-2 text-muted-foreground" />
                        Du hast noch keine Zertifikate erworben.
                      </div>
                    ) : (
                      <div className="divide-y divide-border border-y">
                        {certificates.map((cert) => (
                          <div
                            key={cert.id}
                            className="flex min-w-0 flex-col gap-4 py-4"
                          >
                            <div className="flex min-w-0 items-start gap-4">
                              <Award className="mt-1 h-8 w-8 shrink-0 text-primary" />
                              <div className="min-w-0">
                                <h4 className="font-medium">{cert.courseName}</h4>
                                <p className="text-sm text-muted-foreground">
                                  Ausgestellt am: {new Date(cert.issuedAt).toLocaleDateString('de-DE')}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                aria-label={`${cert.courseName} anzeigen`}
                                onClick={() => window.open(`/verify-certificate/${cert.id}`, '_blank', 'noopener,noreferrer')}
                              >
                                <Eye className="w-4 h-4 mr-2" />
                                Anzeigen
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                aria-label={`${cert.courseName} herunterladen`}
                                onClick={async () => {
                                  try {
                                    const response = await fetch(`/api/courses/${cert.courseId}/certificate`, {
                                      method: 'POST',
                                      signal: actionController.current?.signal,
                                    });

                                    if (!response.ok) {
                                      throw new Error('Failed to generate certificate');
                                    }

                                    const blob = await response.blob();
                                    if (actionController.current?.signal.aborted) return;
                                    const url = window.URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `${cert.courseName.replace(/\s+/g, '_')}_Certificate.pdf`;
                                    document.body.appendChild(a);
                                    a.click();
                                    a.remove();
                                    window.URL.revokeObjectURL(url);
                                  } catch (error) {
                                    if (actionController.current?.signal.aborted) return;
                                    console.error('Error downloading certificate:', error);
                                    toast.error('Das Zertifikat konnte nicht heruntergeladen werden.');
                                  }
                                }}
                              >
                                <Download className="w-4 h-4 mr-2" />
                                Download
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                aria-label={`${cert.courseName} zu LinkedIn hinzufügen`}
                                onClick={() => {
                                  const baseUrl = window.location.origin;
                                  const verificationUrl = `${baseUrl}/verify-certificate/${cert.id}`;
                                  window.open(`https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=${encodeURIComponent(cert.courseName)}&organizationName=Forge%20Community&issueYear=${new Date(cert.issuedAt).getFullYear()}&issueMonth=${new Date(cert.issuedAt).getMonth() + 1}&certUrl=${encodeURIComponent(verificationUrl)}`, '_blank', 'noopener,noreferrer');
                                }}
                              >
                                <Linkedin className="w-4 h-4 mr-2" />
                                Zu LinkedIn hinzufügen
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
            )}
          </div>
        </main>
      </div>

      {/* Bearbeitungs-Modal */}
      {editSkill && (
        <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Fähigkeit bearbeiten</DialogTitle>
              <DialogDescription>
                Kenntnisstand ändern für &quot;{editSkill.skill?.name}&quot;.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <Label htmlFor="edit-skill-level">Kenntnisstand</Label>
              <Select
                value={String(editSkill.level)}
                onValueChange={(value) => setEditSkill({ ...editSkill, level: Number(value) })}
              >
                <SelectTrigger id="edit-skill-level">
                  <SelectValue placeholder="Kenntnisstand auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {SKILL_LEVELS.map((level) => (
                    <SelectItem key={level.value} value={String(level.value)}>
                      {level.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="mt-6">
              <Button onClick={handleEditSkill}>Speichern</Button>
              <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>
                Abbrechen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      )}
    </AppShell>
  )
}
