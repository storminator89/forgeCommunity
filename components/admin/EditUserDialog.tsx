'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { toast } from 'react-toastify'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

interface User {
  id: string
  name: string
  email: string
  role: 'USER' | 'ADMIN' | 'MODERATOR' | 'INSTRUCTOR'
  title?: string
  bio?: string
  contact?: string
  image?: string | null
  settings?: {
    emailNotifications: boolean
    pushNotifications: boolean
    theme: 'LIGHT' | 'DARK'
    language: string
  }
}

interface EditUserDialogProps {
  user: User | null
  isOpen: boolean
  onClose: () => void
  onUpdateUser: (user: User) => void
}

interface UserFormData {
  name: string
  email: string
  password: string // Optional für Updates
  role: 'USER' | 'ADMIN' | 'MODERATOR' | 'INSTRUCTOR'
  title: string
  bio: string
  contact: string
  emailNotifications: boolean
  pushNotifications: boolean
  theme: 'LIGHT' | 'DARK'
  language: string
  image?: string | null
}

export function EditUserDialog({ user, isOpen, onClose, onUpdateUser }: EditUserDialogProps) {
  const [formData, setFormData] = useState<UserFormData>({
    name: '',
    email: '',
    password: '',
    role: 'USER',
    title: '',
    bio: '',
    contact: '',
    emailNotifications: true,
    pushNotifications: true,
    theme: 'LIGHT',
    language: 'de',
    image: null
  })
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('basic')
  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || '',
        email: user.email || '',
        password: '', // Leer lassen, nur bei Änderung setzen
        role: user.role,
        title: user.title || '',
        bio: user.bio || '',
        contact: user.contact || '',
        emailNotifications: user.settings?.emailNotifications ?? true,
        pushNotifications: user.settings?.pushNotifications ?? true,
        theme: user.settings?.theme || 'LIGHT',
        language: user.settings?.language || 'de',
        image: user.image
      })
    }
  }, [user])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return

    setIsLoading(true)

    try {
      // Validierung
      if (!formData.name || !formData.email) {
        toast.error('Bitte füllen Sie alle Pflichtfelder aus')
        return
      }

      if (formData.password && formData.password.length < 8) {
        toast.error('Das Passwort muss mindestens 8 Zeichen lang sein')
        return
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(formData.email)) {
        toast.error('Bitte geben Sie eine gültige E-Mail-Adresse ein')
        return
      }

      // Erstellen des Update-Objekts
      const updateData: any = {
        name: formData.name,
        email: formData.email,
        role: formData.role,
        title: formData.title,
        bio: formData.bio,
        contact: formData.contact,
        settings: {
          emailNotifications: formData.emailNotifications,
          pushNotifications: formData.pushNotifications,
          theme: formData.theme,
          language: formData.language,
        }
      }

      // Nur hinzufügen, wenn ein neues Passwort gesetzt wurde
      if (formData.password) {
        updateData.password = formData.password
      }

      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Fehler beim Aktualisieren des Benutzers')
      }

      const updatedUser = await response.json()
      onUpdateUser(updatedUser)
      toast.success('Benutzer erfolgreich aktualisiert')
      handleClose()
    } catch (error) {
      console.error('Error updating user:', error)
      toast.error(error instanceof Error ? error.message : 'Fehler beim Aktualisieren des Benutzers')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setActiveTab('basic')
    onClose()
  }

  const handleInputChange = (
    field: keyof UserFormData,
    value: string | boolean
  ) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  if (!user) return null
  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-4">
            <Avatar className="h-10 w-10">
              <AvatarImage src={user.image || ''} alt={user.name} />
              <AvatarFallback>{user.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              Benutzer bearbeiten
              <p className="text-sm text-gray-500 dark:text-gray-400 font-normal mt-1">
                ID: {user.id}
              </p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="basic">Basisdaten</TabsTrigger>
              <TabsTrigger value="profile">Profil</TabsTrigger>
              <TabsTrigger value="settings">Einstellungen</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    placeholder="Max Mustermann"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">E-Mail *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    placeholder="max@beispiel.de"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="password">
                    Neues Passwort
                    <span className="text-sm text-gray-500 ml-2">(optional)</span>
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => handleInputChange('password', e.target.value)}
                    placeholder="Leer lassen für keine Änderung"
                  />
                  <p className="text-xs text-gray-500">
                    Mindestens 8 Zeichen
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="role">Rolle *</Label>
                  <Select
                    value={formData.role}
                    onValueChange={(value: UserFormData['role']) => 
                      handleInputChange('role', value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Rolle auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USER">Benutzer</SelectItem>
                      <SelectItem value="MODERATOR">Moderator</SelectItem>
                      <SelectItem value="INSTRUCTOR">Instruktor</SelectItem>
                      <SelectItem value="ADMIN">Administrator</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="profile" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Titel/Position</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => handleInputChange('title', e.target.value)}
                  placeholder="z.B. Senior Developer"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bio">Biografie</Label>
                <Textarea
                  id="bio"
                  value={formData.bio}
                  onChange={(e) => handleInputChange('bio', e.target.value)}
                  placeholder="Kurze Beschreibung des Benutzers..."
                  className="h-32"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact">Kontaktinformationen</Label>
                <Input
                  id="contact"
                  value={formData.contact}
                  onChange={(e) => handleInputChange('contact', e.target.value)}
                  placeholder="Telefon, Social Media, etc."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="image">Profilbild URL</Label>
                <div className="flex gap-4 items-center">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={formData.image || ''} alt={formData.name} />
                    <AvatarFallback>{formData.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <Input
                    id="image"
                    value={formData.image || ''}
                    onChange={(e) => handleInputChange('image', e.target.value)}
                    placeholder="https://beispiel.de/bild.jpg"
                    className="flex-1"
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="settings" className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="emailNotifications">
                      E-Mail Benachrichtigungen
                    </Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Erhält Benachrichtigungen per E-Mail
                    </p>
                  </div>
                  <Switch
                    id="emailNotifications"
                    checked={formData.emailNotifications}
                    onCheckedChange={(checked) => 
                      handleInputChange('emailNotifications', checked)
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="pushNotifications">
                      Push Benachrichtigungen
                    </Label>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Erhält Push Benachrichtigungen im Browser
                    </p>
                  </div>
                  <Switch
                    id="pushNotifications"
                    checked={formData.pushNotifications}
                    onCheckedChange={(checked) => 
                      handleInputChange('pushNotifications', checked)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="theme">Theme</Label>
                  <Select
                    value={formData.theme}
                    onValueChange={(value: 'LIGHT' | 'DARK') => 
                      handleInputChange('theme', value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Theme auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LIGHT">Hell</SelectItem>
                      <SelectItem value="DARK">Dunkel</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="language">Sprache</Label>
                  <Select
                    value={formData.language}
                    onValueChange={(value) => 
                      handleInputChange('language', value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sprache auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="de">Deutsch</SelectItem>
                      <SelectItem value="en">Englisch</SelectItem>
                      <SelectItem value="fr">Französisch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      Kontostatus
                    </h4>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      <p>Erstellt am: {new Date(user.createdAt).toLocaleDateString('de-DE')}</p>
                      {user.emailVerified && (
                        <p>Verifiziert am: {new Date(user.emailVerified).toLocaleDateString('de-DE')}</p>
                      )}
                      {user.lastLogin && (
                        <p>Letzter Login: {new Date(user.lastLogin).toLocaleDateString('de-DE')}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
              className="mr-2"
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Wird gespeichert...
                </span>
              ) : (
                'Änderungen speichern'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
