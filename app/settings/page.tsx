"use client"

import { AppShell, AppHeader } from '@/components/app-shell';
import { useState, useEffect } from 'react'
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
import { Bell, Lock, Globe, CheckCircle, XCircle, Code, Database, Languages, Edit, Trash, Award, ExternalLink, Linkedin, Eye, User, Download, Layout } from 'lucide-react'
import { ImageUpload } from "@/components/ImageUpload"
import axios from 'axios'
import { toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

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
  { label: 'Beginner', value: 33, color: 'bg-blue-500' },
  { label: 'Fortgeschritten', value: 66, color: 'bg-green-500' },
  { label: 'Experte', value: 100, color: 'bg-purple-500' }
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
  // Grundlegende Benutzerinformationen
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [userImage, setUserImage] = useState<string | null>(null)
  const [language, setLanguage] = useState('de')
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [pushNotifications, setPushNotifications] = useState(true)

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
    const fetchData = async () => {
      setIsLoading(true)
      try {
        const [skillsResponse, userSkillsResponse, userResponse, certificatesResponse] = await Promise.all([
          axios.get('/api/skills'),
          axios.get('/api/user/skills'),
          axios.get('/api/user/profile'),
          axios.get('/api/user/certificates')
        ])
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
        setCertificates(certificatesResponse.data)
        setIsLoaded(true)
      } catch (error) {
        console.error("Fehler beim Abrufen der Daten:", error)
        setLoadError("Die Einstellungen konnten nicht geladen werden. Bitte lade die Seite erneut.")
        toast.error("Beim Laden der Daten ist ein Fehler aufgetreten.")
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  const handleImageUpdate = async (newImageUrl: string) => {
    setUserImage(newImageUrl)
    try {
      await axios.put('/api/user/profile', { image: newImageUrl })
    } catch (error) {
      console.error("Fehler beim Aktualisieren des Profilbilds:", error)
      toast.error("Fehler beim Aktualisieren des Profilbilds")
    }
  }

  const handleSave = async () => {
    if (!isLoaded || isLoading || isSaving) return
    setIsSaving(true)
    try {
      await axios.put('/api/user/profile', {
        name,
        email,
        language,
        emailNotifications,
        pushNotifications
      })
      toast.success("Einstellungen erfolgreich gespeichert.")
    } catch (error) {
      console.error("Fehler beim Speichern der Einstellungen:", error)
      toast.error("Beim Speichern der Einstellungen ist ein Fehler aufgetreten.")
    } finally {
      setIsSaving(false)
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
        })
        skillId = createSkillResponse.data.id
      }

      if (!skillId) {
        toast.error("Bitte wählen Sie eine gültige Fähigkeit aus.")
        return
      }

      if (newSkillLevel < 0 || newSkillLevel > 100) {
        toast.error("Das Fähigkeitslevel muss zwischen 0 und 100 liegen.")
        return
      }

      await axios.post('/api/user/skills', { skillId, level: newSkillLevel })
      const response = await axios.get('/api/user/skills')
      setUserSkills(response.data)
      toast.success("Fähigkeit erfolgreich hinzugefügt.")
      setNewSkillId('')
      setNewSkillLevel(0)
      setNewSkillName('')
    } catch (error: any) {
      console.error("Fehler beim Hinzufügen der Fähigkeit:", error)
      toast.error(error.response?.data?.error || "Fehler beim Hinzufügen der Fähigkeit.")
    }
  }

  const handleDeleteSkill = async (skillId: string) => {
    try {
      await axios.delete(`/api/user/skills/${skillId}`)
      const response = await axios.get('/api/user/skills')
      setUserSkills(response.data)
      toast.success("Fähigkeit erfolgreich gelöscht.")
    } catch (error: any) {
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

      await axios.put(`/api/user/skills/${editSkill.skillId}`, { level: editSkill.level })
      const response = await axios.get('/api/user/skills')
      setUserSkills(response.data)
      toast.success("Fähigkeit erfolgreich aktualisiert.")
      setIsEditModalOpen(false)
      setEditSkill(null)
    } catch (error: any) {
      console.error("Fehler beim Aktualisieren der Fähigkeit:", error)
      toast.error(error.response?.data?.error || "Fehler beim Aktualisieren der Fähigkeit.")
    }
  }

  const getSkillIcon = (skillName: string) => {
    const name = skillName.toLowerCase()
    if (name.includes('javascript') || name.includes('typescript') || name.includes('python')) {
      return <Code className="w-5 h-5 text-blue-500" />
    } else if (name.includes('design') || name.includes('ui') || name.includes('ux')) {
      return <Layout className="w-5 h-5 text-pink-500" />
    } else if (name.includes('database') || name.includes('sql') || name.includes('mongodb')) {
      return <Database className="w-5 h-5 text-green-500" />
    } else if (name.includes('language') || name.includes('german') || name.includes('english')) {
      return <Languages className="w-5 h-5 text-yellow-500" />
    }
    return <CheckCircle className="w-5 h-5 text-muted-foreground" />
  }

  return (
    <AppShell>
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <AppHeader>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <h2 className="text-xl sm:text-2xl font-bold text-foreground">Einstellungen</h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </AppHeader>

        {/* Hauptinhalt */}
        <main id="page-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="max-w-4xl mx-auto">
            {loadError && <div role="alert" className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4"><p>{loadError}</p><Button variant="outline" className="mt-3" onClick={() => window.location.reload()}>Erneut laden</Button></div>}
            <Tabs defaultValue="account" className="w-full">
              <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-muted p-1 mb-6 sm:grid-cols-4">
                <TabsTrigger value="account" className="w-full">
                  <User className="w-4 h-4 mr-2" />
                  Account
                </TabsTrigger>
                <TabsTrigger value="notifications" className="w-full">
                  <Bell className="w-4 h-4 mr-2" />
                  Benachrichtigungen
                </TabsTrigger>
                <TabsTrigger value="skills" className="w-full">
                  <Code className="w-4 h-4 mr-2" />
                  Fähigkeiten
                </TabsTrigger>
                <TabsTrigger value="certificates" className="w-full">
                  <Award className="w-4 h-4 mr-2" />
                  Zertifikate
                </TabsTrigger>
              </TabsList>

              {/* Konto-Tab */}
              <TabsContent value="account">
                <Card>
                  <CardHeader>
                    <CardTitle>Kontoinformationen</CardTitle>
                    <CardDescription>Aktualisieren Sie Ihre Kontoinformationen hier.</CardDescription>
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
                    <CardDescription>Verwalten Sie Ihre Benachrichtigungspräferenzen.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center space-x-2">
                        <Bell className="w-5 h-5 text-muted-foreground" />
                        <Label htmlFor="email-notifications">E-Mail-Benachrichtigungen</Label>
                      </div>
                      <Switch
                        id="email-notifications"
                        checked={emailNotifications}
                        onCheckedChange={setEmailNotifications}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center space-x-2">
                        <Bell className="w-5 h-5 text-muted-foreground" />
                        <Label htmlFor="push-notifications">Push-Benachrichtigungen</Label>
                      </div>
                      <Switch
                        id="push-notifications"
                        checked={pushNotifications}
                        onCheckedChange={setPushNotifications}
                      />
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
                    <CardDescription>Verwalten Sie Ihre Privatsphäre-Einstellungen.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center space-x-2">
                        <Globe className="w-5 h-5 text-muted-foreground" />
                        <Label htmlFor="profile-visibility">Öffentliches Profil</Label>
                      </div>
                      <Switch id="profile-visibility" />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center space-x-2">
                        <Lock className="w-5 h-5 text-muted-foreground" />
                        <Label htmlFor="two-factor-auth">Zwei-Faktor-Authentifizierung</Label>
                      </div>
                      <Switch id="two-factor-auth" />
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
                      <CardTitle>Ihre Fähigkeiten</CardTitle>
                      <CardDescription>Verwalten Sie Ihre bestehenden Fähigkeiten.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {isLoading ? (
                        <p className="text-muted-foreground">Lade Fähigkeiten...</p>
                      ) : (
                        <ul className="space-y-4">
                          {userSkills.map((userSkill) => (
                            <li key={userSkill.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 bg-muted/40 rounded-xl border">
                              <div className="flex items-center space-x-4">
                                {getSkillIcon(userSkill.skill?.name || "")}
                                <div className="flex-1">
                                  <span className="font-medium text-foreground">
                                    {userSkill.skill?.name || "Unbekannte Fähigkeit"}
                                  </span>
                                  <div className="mt-2">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-sm text-muted-foreground">
                                        {getLevelLabel(userSkill.level)}
                                      </span>
                                    </div>
                                    <div className="w-full min-w-0 sm:w-48 bg-muted rounded-full h-2.5">
                                      <div
                                        className={`h-2.5 rounded-full ${findNearestLevel(userSkill.level).color}`}
                                        style={{ width: `${userSkill.level}%` }}
                                      ></div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-foreground hover:bg-accent"
                                  onClick={() => {
                                    setEditSkill(userSkill)
                                    setIsEditModalOpen(true)
                                  }}
                                  aria-label="Bearbeiten"
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-foreground hover:bg-accent"
                                  onClick={() => handleDeleteSkill(userSkill.skillId)}
                                  aria-label="Löschen"
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
                      <CardDescription>Fügen Sie eine neue Fähigkeit hinzu.</CardDescription>
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
                            <SelectValue placeholder="Wählen Sie Ihren Kenntnisstand" />
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
                    <CardDescription>
                      Hier findest du eine Übersicht über alle deine erworbenen Zertifikate.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {certificates.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground">
                        <Award className="w-12 h-12 mx-auto mb-2 text-muted-foreground" />
                        Du hast noch keine Zertifikate erworben.
                      </div>
                    ) : (
                      <div className="grid gap-4">
                        {certificates.map((cert) => (
                          <div
                            key={cert.id}
                            className="flex flex-col gap-4 p-4 border rounded-xl hover:bg-accent"
                          >
                            <div className="flex items-start space-x-4">
                              <Award className="w-8 h-8 mt-1 text-primary" />
                              <div>
                                <h3 className="font-medium">{cert.courseName}</h3>
                                <p className="text-sm text-muted-foreground">
                                  Ausgestellt am: {new Date(cert.issuedAt).toLocaleDateString('de-DE')}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => window.open(`/verify-certificate/${cert.id}`, '_blank', 'noopener,noreferrer')}
                              >
                                <Eye className="w-4 h-4 mr-2" />
                                Anzeigen
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={async () => {
                                  try {
                                    const response = await fetch(`/api/courses/${cert.courseId}/certificate`, {
                                      method: 'POST',
                                    });

                                    if (!response.ok) {
                                      throw new Error('Failed to generate certificate');
                                    }

                                    const blob = await response.blob();
                                    const url = window.URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `${cert.courseName.replace(/\s+/g, '_')}_Certificate.pdf`;
                                    document.body.appendChild(a);
                                    a.click();
                                    a.remove();
                                    window.URL.revokeObjectURL(url);
                                  } catch (error) {
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
                                onClick={() => {
                                  const baseUrl = window.location.origin;
                                  const verificationUrl = `${baseUrl}/verify-certificate/${cert.id}`;
                                  window.open(`https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=${encodeURIComponent(cert.courseName)}&organizationName=Forge%20Community&issueYear=${new Date(cert.issuedAt).getFullYear()}&issueMonth=${new Date(cert.issuedAt).getMonth() + 1}&certUrl=${encodeURIComponent(verificationUrl)}`, '_blank');
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
                Aktualisieren Sie den Kenntnisstand für &quot;{editSkill.skill?.name}&quot;.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <Label htmlFor="edit-skill-level">Kenntnisstand</Label>
              <Select
                value={String(editSkill.level)}
                onValueChange={(value) => setEditSkill({ ...editSkill, level: Number(value) })}
              >
                <SelectTrigger id="edit-skill-level">
                  <SelectValue placeholder="Wählen Sie Ihren Kenntnisstand" />
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
