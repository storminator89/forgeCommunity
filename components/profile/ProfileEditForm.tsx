"use client";

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Edit2, 
  Loader2, 
  Save,
  User,
  Mail,
  Briefcase,
  FileText,
  Phone,
  Image as ImageIcon,
  Camera,
  X,
  AlertCircle
} from 'lucide-react';
import { toast } from 'react-toastify';
import { motion, AnimatePresence } from 'framer-motion';

interface ProfileData {
  name: string;
  title: string | null;
  bio: string | null;
  contact: string | null;
  image?: string | null;
}

interface ProfileEditFormProps {
  userId: string;
  initialData: ProfileData;
  onUpdate: (data: ProfileData) => void;
}

export function ProfileEditForm({ userId, initialData, onUpdate }: ProfileEditFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const [formData, setFormData] = useState<ProfileData>(initialData);
  const [imagePreview, setImagePreview] = useState<string | null>(initialData.image || null);
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileData, string>>>({});

  const validateForm = () => {
    const newErrors: Partial<Record<keyof ProfileData, string>> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name ist erforderlich';
    }

    if (formData.contact && !isValidContact(formData.contact)) {
      newErrors.contact = 'Ungültiges Kontaktformat';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isValidContact = (contact: string) => {
    // Einfache Validierung für E-Mail oder Telefonnummer
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^\+?[\d\s-]{8,}$/;
    return emailRegex.test(contact) || phoneRegex.test(contact);
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Bitte wählen Sie ein Bild aus');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Das Bild darf nicht größer als 5MB sein');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    // Hier können Sie das Bild direkt hochladen oder für späteren Upload speichern
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error('Bitte korrigieren Sie die markierten Fehler');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`/api/users/${userId}/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to update profile');
      }

      const data = await response.json();
      onUpdate(data.user);
      toast.success('Profil erfolgreich aktualisiert');
      setIsOpen(false);
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error('Fehler beim Aktualisieren des Profils');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setFormData(initialData);
    setImagePreview(initialData.image || null);
    setErrors({});
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) handleReset();
      setIsOpen(open);
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Edit2 className="h-4 w-4" />
          Profil bearbeiten
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Profil bearbeiten</DialogTitle>
          <DialogDescription>
            Aktualisieren Sie Ihre Profilinformationen. Klicken Sie auf Speichern, wenn Sie fertig sind.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="basic" className="gap-2">
              <User className="h-4 w-4" />
              Basis-Informationen
            </TabsTrigger>
            <TabsTrigger value="media" className="gap-2">
              <ImageIcon className="h-4 w-4" />
              Medien
            </TabsTrigger>
          </TabsList>

          <form onSubmit={handleSubmit} className="space-y-6 py-4">
            <TabsContent value="basic">
              <Card>
                <CardHeader>
                  <CardTitle>Persönliche Informationen</CardTitle>
                  <CardDescription>
                    Bearbeiten Sie Ihre grundlegenden Profilinformationen.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name" className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Name
                    </Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => {
                        setFormData({ ...formData, name: e.target.value });
                        if (errors.name) setErrors({ ...errors, name: undefined });
                      }}
                      className={errors.name ? 'border-red-500' : ''}
                      placeholder="Ihr vollständiger Name"
                    />
                    {errors.name && (
                      <p className="text-sm text-red-500 flex items-center gap-1">
                        <AlertCircle className="h-4 w-4" />
                        {errors.name}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="title" className="flex items-center gap-2">
                      <Briefcase className="h-4 w-4" />
                      Titel/Position
                    </Label>
                    <Input
                      id="title"
                      value={formData.title || ''}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      placeholder="z.B. Senior Developer"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bio" className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Über mich
                    </Label>
                    <Textarea
                      id="bio"
                      value={formData.bio || ''}
                      onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                      placeholder="Erzählen Sie etwas über sich..."
                      className="h-32 resize-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="contact" className="flex items-center gap-2">
                      <Phone className="h-4 w-4" />
                      Kontakt
                    </Label>
                    <Input
                      id="contact"
                      value={formData.contact || ''}
                      onChange={(e) => {
                        setFormData({ ...formData, contact: e.target.value });
                        if (errors.contact) setErrors({ ...errors, contact: undefined });
                      }}
                      className={errors.contact ? 'border-red-500' : ''}
                      placeholder="E-Mail oder Telefonnummer"
                    />
                    {errors.contact && (
                      <p className="text-sm text-red-500 flex items-center gap-1">
                        <AlertCircle className="h-4 w-4" />
                        {errors.contact}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="media">
              <Card>
                <CardHeader>
                  <CardTitle>Profilbild</CardTitle>
                  <CardDescription>
                    Laden Sie ein Profilbild hoch oder ändern Sie es.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-center">
                    <div className="relative">
                      <Avatar className="h-32 w-32">
                        <AvatarImage src={imagePreview || ''} />
                        <AvatarFallback>
                          {formData.name?.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <label
                        htmlFor="profile-image"
                        className="absolute bottom-0 right-0 p-1 bg-white dark:bg-gray-800 rounded-full shadow-lg cursor-pointer"
                      >
                        <Camera className="h-4 w-4" />
                        <input
                          type="file"
                          id="profile-image"
                          className="hidden"
                          accept="image/*"
                          onChange={handleImageChange}
                        />
                      </label>
                    </div>
                  </div>
                  {imagePreview && imagePreview !== initialData.image && (
                    <div className="flex justify-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setImagePreview(initialData.image)}
                        className="gap-2"
                      >
                        <X className="h-4 w-4" />
                        Zurücksetzen
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <Separator />

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsOpen(false)}
                disabled={isLoading}
              >
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={isLoading}
                className="gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Speichern...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Speichern
                  </>
                )}
              </Button>
            </div>
          </form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}