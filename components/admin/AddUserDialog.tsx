'use client'

import { useState } from 'react'
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

interface AddUserDialogProps {
  isOpen: boolean
  onClose: () => void
  onAddUser: (user: any) => void
}

interface UserFormData {
  name: string
  email: string
  password: string
  role: 'USER' | 'ADMIN' | 'MODERATOR' | 'INSTRUCTOR'
  title: string
  bio: string
  contact: string
  emailNotifications: boolean
  pushNotifications: boolean
  theme: 'LIGHT' | 'DARK'
  language: string
}

const initialFormData: UserFormData = {
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
  language: 'de'
}

export default function AddUserDialog({ isOpen, onClose, onAddUser }: AddUserDialogProps) {
  const [formData, setFormData] = useState<UserFormData>(initialFormData)
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('basic')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      // Validierung
      if (!formData.name || !formData.email || !formData.password) {
        toast.error('Bitte füllen Sie alle Pflichtfelder aus')
        return
      }

      if (formData.password.length < 8) {
        toast.error('Das Passwort muss mindestens 8 Zeichen lang sein')
        return
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(formData.email)) {
        toast.error('Bitte geben Sie eine gültige E-Mail-Adresse ein')
        return
      }

      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          settings: {
            emailNotifications: formData.emailNotifications,
            pushNotifications: formData.pushNotifications,
            theme: formData.theme,
            language: formData.language,
          }
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Fehler beim Erstellen des Benutzers')
      }

      const newUser = await response.json()
      onAddUser(newUser)
      toast.success('Benutzer erfolgreich erstellt')
      handleClose()
    } catch (error) {
      console.error('Error creating user:', error)
      toast.error(error instanceof Error ? error.message : 'Fehler beim Erstellen des Benutzers')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setFormData(initialFormData)
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
  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Neuen Benutzer erstellen</DialogTitle>
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
                  <Label htmlFor="password">Passwort *</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => handleInputChange('password', e.target.value)}
                    placeholder="••••••••"
                    required
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
            </TabsContent>

            <TabsContent value="settings" className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="emailNotifications">
                      E-Mail Benachrichtigungen
                    </Label>
                    <p className="text-sm text-gray-500">
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
                    <p className="text-sm text-gray-500">
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
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
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
                  Wird erstellt...
                </span>
              ) : (
                'Benutzer erstellen'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
