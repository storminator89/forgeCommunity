"use client";

import { useState } from 'react';
import { ProfileEditForm } from './ProfileEditForm';
import { ImageUpload } from './ImageUpload';
import { SocialLinksForm } from './SocialLinksForm';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  User,
  Image as ImageIcon,
  Share2,
  Trash2,
  Github,
  Linkedin,
  Twitter,
  Globe,
  Upload,
  Camera
} from 'lucide-react';
import { toast } from 'react-toastify';
import Image from 'next/image';
import { getSafeHttpUrl } from '@/lib/security';

interface ProfileData {
  id: string;
  name: string | null;
  title: string | null;
  bio: string | null;
  contact: string | null;
  image: string | null;
  coverImage: string | null;
  socialLinks?: {
    github?: string | null;
    linkedin?: string | null;
    twitter?: string | null;
    website?: string | null;
  };
}

interface ProfileEditorProps {
  profile: ProfileData;
  onUpdate: (data: Partial<ProfileData>) => void;
}

const socialIcons = {
  github: <Github className="h-5 w-5" />,
  linkedin: <Linkedin className="h-5 w-5" />,
  twitter: <Twitter className="h-5 w-5" />,
  website: <Globe className="h-5 w-5" />
};

const socialLabels = {
  github: 'GitHub',
  linkedin: 'LinkedIn',
  twitter: 'Twitter',
  website: 'Website'
};

export function ProfileEditor({ profile, onUpdate }: ProfileEditorProps) {
  const [activeTab, setActiveTab] = useState('basic');
  const [isLoading, setIsLoading] = useState(false);

  const calculateCompletionScore = () => {
    let score = 0;
    let total = 0;

    // Basis-Informationen
    if (profile.name) score++; total++;
    if (profile.title) score++; total++;
    if (profile.bio) score++; total++;
    if (profile.contact) score++; total++;

    // Bilder
    if (profile.image) score++; total++;
    if (profile.coverImage) score++; total++;

    // Soziale Medien
    if (profile.socialLinks) {
      Object.values(profile.socialLinks).forEach(link => {
        if (link) score++;
        total++;
      });
    }

    return Math.round((score / total) * 100);
  };

  const handleProfileUpdate = async (data: Partial<ProfileData>) => {
    setIsLoading(true);
    try {
      await onUpdate(data);
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error('Fehler beim Aktualisieren des Profils');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageUpdate = (type: 'avatar' | 'cover') => (imageUrl: string) => {
    onUpdate({ [type === 'avatar' ? 'image' : 'coverImage']: imageUrl });
  };

  const handleDeleteImage = async (type: 'avatar' | 'cover') => {
    const imageType = type === 'avatar' ? 'Profilbild' : 'Titelbild';
    if (!window.confirm(`${imageType} aus dem Profil entfernen?`)) return;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(profile.id)}/upload?type=${type}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!response.ok) throw new Error('Bild konnte nicht entfernt werden.');
      onUpdate({ [type === 'avatar' ? 'image' : 'coverImage']: null });
      toast.success(`${imageType} aus dem Profil entfernt`);
    } catch (error) {
      console.error('Error removing profile image:', error);
      toast.error(`${imageType} konnte nicht entfernt werden.`);
    } finally {
      setIsLoading(false);
    }
  };

  const renderSocialLinks = () => {
    if (!profile.socialLinks) return null;

    const hasLinks = Object.values(profile.socialLinks).some(value => getSafeHttpUrl(value));
    if (!hasLinks) return null;

    return (
      <div className="flex flex-wrap gap-4 mb-6">
        {(Object.entries(profile.socialLinks) as [keyof typeof socialIcons, string][])
          .map(([key, value]) => [key, getSafeHttpUrl(value)] as const)
          .filter((entry): entry is readonly [keyof typeof socialIcons, string] => entry[1] !== null)
          .map(([key, value]) => (
            <a
              key={key}
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {socialIcons[key]}
              <span className="text-sm font-medium">{socialLabels[key]}</span>
            </a>
          ))}
      </div>
    );
  };

  const renderMediaSection = ({ type, title }: { type: 'avatar' | 'cover'; title: string }) => {
    const currentImage = type === 'avatar' ? profile.image : profile.coverImage;
    const imageType = type === 'avatar' ? 'Profilbild' : 'Titelbild';

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 justify-between items-center">
          <div>
            <h4 className="text-sm font-medium">{title}</h4>
            <p className="text-sm text-muted-foreground">
              {currentImage
                ? `Aktuelles ${imageType} hochgeladen`
                : `Kein ${imageType} vorhanden`}
            </p>
          </div>
          {currentImage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDeleteImage(type)}
              className="flex items-center gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              <span>{imageType} entfernen</span>
            </Button>
          )}
        </div>

        <div className="relative">
          {currentImage ? (
            <div className="space-y-3">
              <div className={`relative w-full overflow-hidden rounded-[10px] bg-muted ${type === 'avatar' ? 'aspect-square max-w-48' : 'aspect-video'}`}>
                <Image
                  src={currentImage}
                  alt={imageType}
                  fill
                  className="object-cover"
                />
              </div>
              <ImageUpload userId={profile.id} type={type} currentImage={currentImage} onUpdate={handleImageUpdate(type)}><Button type="button" variant="outline" size="sm"><Camera className="h-4 w-4" aria-hidden="true" />{imageType} ändern</Button></ImageUpload>
            </div>
          ) : (
            <div className="border-2 border-dashed border-border rounded-lg p-8">
              <div className="flex flex-col items-center justify-center text-center">
                <ImageIcon className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-sm font-medium text-foreground">
                  Kein {imageType} vorhanden
                </h3>
                <ImageUpload
                  userId={profile.id}
                  type={type}
                  currentImage={currentImage}
                  onUpdate={handleImageUpdate(type)}
                >
                  <Button variant="secondary" size="sm" className="mt-4 flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    {imageType} hochladen
                  </Button>
                </ImageUpload>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };
  return (
    <section aria-labelledby="profile-manage-title" className="mt-8 border-y py-6">
      <div className="mb-6">
        <h2 id="profile-manage-title" className="text-xl font-semibold tracking-tight">Profil verwalten</h2>
        <p className="mt-1 text-sm text-muted-foreground">Stammdaten, Bilder und externe Profile bearbeiten.</p>
      </div>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList aria-label="Profil bearbeiten" className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-none border-b bg-transparent p-0">
          <TabsTrigger value="basic" className="min-h-11 gap-2"><User className="h-4 w-4" aria-hidden="true" />Stammdaten</TabsTrigger>
          <TabsTrigger value="media" className="min-h-11 gap-2"><ImageIcon className="h-4 w-4" aria-hidden="true" />Medien</TabsTrigger>
          <TabsTrigger value="social" className="min-h-11 gap-2"><Share2 className="h-4 w-4" aria-hidden="true" />Soziale Links</TabsTrigger>
        </TabsList>
        <TabsContent value="basic" className="pt-6">
          <h3 className="text-lg font-semibold">Persönliche Informationen</h3>
          <p className="mt-1 text-sm text-muted-foreground">Name, Kontakt und Kurzbeschreibung.</p>
          <div className="mt-4"><ProfileEditForm userId={profile.id} initialData={{ name: profile.name || '', title: profile.title, bio: profile.bio, contact: profile.contact }} onUpdate={handleProfileUpdate} /></div>
        </TabsContent>
        <TabsContent value="media" className="pt-6">
          <h3 className="text-lg font-semibold">Medien verwalten</h3>
          <p className="mt-1 text-sm text-muted-foreground">Profil- und Titelbild auswählen oder entfernen.</p>
          <div className="mt-5 grid min-w-0 gap-8 md:grid-cols-2">
            <div className="min-w-0 border-t pt-4">{renderMediaSection({ type: 'avatar', title: 'Profilbild' })}</div>
            <div className="min-w-0 border-t pt-4">{renderMediaSection({ type: 'cover', title: 'Titelbild' })}</div>
          </div>
        </TabsContent>
        <TabsContent value="social" className="pt-6">
          <h3 className="text-lg font-semibold">Soziale Medien</h3>
          <p className="mt-1 text-sm text-muted-foreground">Diese Links erscheinen auf deinem Profil.</p>
          {renderSocialLinks()}
          <div className="mt-4"><SocialLinksForm userId={profile.id} initialData={profile.socialLinks || {}} onUpdate={(data) => handleProfileUpdate({ socialLinks: data })} /></div>
        </TabsContent>
      </Tabs>
      <div className="mt-7 border-t pt-5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm"><span className="font-medium">Profilvollständigkeit</span><span className="tabular-nums text-muted-foreground">{calculateCompletionScore()}%</span></div>
        <Progress value={calculateCompletionScore()} className="h-2" aria-label={`Profilvollständigkeit: ${calculateCompletionScore()} Prozent`} />
        <p className="mt-2 text-sm text-muted-foreground">{calculateCompletionScore() === 100 ? 'Profil vollständig' : 'Du kannst weitere Informationen ergänzen.'}</p>
      </div>
      {isLoading && <p role="status" className="mt-4 text-sm text-muted-foreground">Änderungen werden gespeichert…</p>}
    </section>
  );
}
