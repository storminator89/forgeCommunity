"use client";

import { useState } from 'react';
import { ProfileEditForm } from './ProfileEditForm';
import { ImageUpload } from './ImageUpload';
import { SocialLinksForm } from './SocialLinksForm';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  User,
  Image as ImageIcon,
  Share2,
  Settings,
  CheckCircle,
  AlertCircle,
  Trash2,
  Github,
  Linkedin,
  Twitter,
  Globe,
  Upload,
  Camera
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import Image from 'next/image';

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

const socialColors = {
  github: 'hover:text-gray-900 dark:hover:text-white',
  linkedin: 'hover:text-blue-600',
  twitter: 'hover:text-blue-400',
  website: 'hover:text-green-500'
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
      toast.success('Profil erfolgreich aktualisiert');
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error('Fehler beim Aktualisieren des Profils');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageUpdate = (type: 'avatar' | 'cover') => async (imageUrl: string | null) => {
    const imageType = type === 'avatar' ? 'Profilbild' : 'Titelbild';
    setIsLoading(true);
    try {
      await onUpdate({
        [type === 'avatar' ? 'image' : 'coverImage']: imageUrl
      });
      if (imageUrl) {
        toast.success(`${imageType} erfolgreich aktualisiert`);
      } else {
        toast.success(`${imageType} erfolgreich entfernt`);
      }
    } catch (error) {
      console.error('Error updating image:', error);
      toast.error(`Fehler beim ${imageUrl ? 'Aktualisieren' : 'Entfernen'} des ${imageType}s`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteImage = async (type: 'avatar' | 'cover') => {
    const imageType = type === 'avatar' ? 'Profilbild' : 'Titelbild';
    if (window.confirm(`Möchten Sie das ${imageType} wirklich entfernen?`)) {
      await handleImageUpdate(type)(null);
    }
  };

  const renderSocialLinks = () => {
    if (!profile.socialLinks) return null;

    const hasLinks = Object.entries(profile.socialLinks).some(([_, value]) => value);
    if (!hasLinks) return null;

    return (
      <div className="flex flex-wrap gap-4 mb-6">
        {(Object.entries(profile.socialLinks) as [keyof typeof socialIcons, string][])
          .filter(([_, value]) => value)
          .map(([key, value]) => (
            <a
              key={key}
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${socialColors[key]}`}
            >
              {socialIcons[key]}
              <span className="text-sm font-medium">{socialLabels[key]}</span>
            </a>
          ))}
      </div>
    );
  };

  const MediaSection = ({ type, title }: { type: 'avatar' | 'cover'; title: string }) => {
    const currentImage = type === 'avatar' ? profile.image : profile.coverImage;
    const imageType = type === 'avatar' ? 'Profilbild' : 'Titelbild';

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h4 className="text-sm font-medium">{title}</h4>
            <p className="text-sm text-gray-500">
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
              className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/10"
            >
              <Trash2 className="h-4 w-4" />
              <span>{imageType} entfernen</span>
            </Button>
          )}
        </div>

        <div className="relative group">
          {currentImage ? (
            <div className="relative rounded-lg overflow-hidden">
              <div className={`w-full ${type === 'avatar' ? 'aspect-square' : 'aspect-video'} relative`}>
                <Image
                  src={currentImage}
                  alt={imageType}
                  fill
                  className="object-cover"
                />
              </div>
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all duration-300 flex items-center justify-center">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <ImageUpload
                    userId={profile.id}
                    type={type}
                    currentImage={currentImage}
                    onUpdate={handleImageUpdate(type)}
                  >
                    <Button variant="secondary" size="sm" className="flex items-center gap-2">
                      <Camera className="h-4 w-4" />
                      {imageType} ändern
                    </Button>
                  </ImageUpload>
                </div>
              </div>
            </div>
          ) : (
            <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-8">
              <div className="flex flex-col items-center justify-center text-center">
                <ImageIcon className="h-12 w-12 text-gray-400 mb-4" />
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Kein {imageType} vorhanden
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Laden Sie ein {imageType} hoch, um Ihr Profil zu vervollständigen
                </p>
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
    <AnimatePresence mode="wait">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.2 }}
      >
        <Card className="mt-6">
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle>Profil bearbeiten</CardTitle>
                <CardDescription>
                  Vervollständigen Sie Ihr Profil, um mehr Sichtbarkeit zu erlangen
                </CardDescription>
              </div>
              <Badge
                variant="secondary"
                className={`flex items-center gap-1 ${calculateCompletionScore() === 100 ? "text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400" : ""}`}
              >
                {calculateCompletionScore() === 100 ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                Profil {calculateCompletionScore()}% vollständig
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-3 mb-8">
                <TabsTrigger value="basic" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Basis-Informationen
                </TabsTrigger>
                <TabsTrigger value="media" className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  Medien
                </TabsTrigger>
                <TabsTrigger value="social" className="flex items-center gap-2">
                  <Share2 className="h-4 w-4" />
                  Soziale Medien
                </TabsTrigger>
              </TabsList>

              <div className="space-y-6">
                <TabsContent value="basic">
                  <Card>
                    <CardHeader>
                      <CardTitle>Persönliche Informationen</CardTitle>
                      <CardDescription>
                        Bearbeiten Sie Ihre grundlegenden Profilinformationen
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ProfileEditForm
                        userId={profile.id}
                        initialData={{
                          name: profile.name || '',
                          title: profile.title,
                          bio: profile.bio,
                          contact: profile.contact,
                        }}
                        onUpdate={handleProfileUpdate}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="media">
                  <Card>
                    <CardHeader>
                      <CardTitle>Medien verwalten</CardTitle>
                      <CardDescription>
                        Laden Sie Ihr Profil- und Titelbild hoch oder ändern Sie diese
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-8">
                      <MediaSection type="avatar" title="Profilbild" />
                      <Separator />
                      <MediaSection type="cover" title="Titelbild" />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="social">
                  <Card>
                    <CardHeader>
                      <CardTitle>Soziale Medien</CardTitle>
                      <CardDescription>
                        Verknüpfen Sie Ihre Profile aus sozialen Medien
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {renderSocialLinks()}
                      <SocialLinksForm
                        userId={profile.id}
                        initialData={profile.socialLinks || {}}
                        onUpdate={(data) => handleProfileUpdate({ socialLinks: data })}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>
              </div>
            </Tabs>

            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">
                  Profilvollständigkeit
                </span>
                <span className="text-sm text-gray-500">
                  {calculateCompletionScore()}%
                </span>
              </div>
              <Progress
                value={calculateCompletionScore()}
                className="h-2"
              />
              <p className="text-sm text-gray-500 mt-2">
                {calculateCompletionScore() === 100 ? (
                  <span className="text-green-500 flex items-center gap-1">
                    <CheckCircle className="h-4 w-4" />
                    Ihr Profil ist vollständig
                  </span>
                ) : (
                  <span className="text-gray-500 flex items-center gap-1">
                    <AlertCircle className="h-4 w-4" />
                    Vervollständigen Sie Ihr Profil für bessere Sichtbarkeit
                  </span>
                )}
              </p>
            </div>

            {isLoading && (
              <div className="fixed inset-0 bg-black/20 dark:bg-black/40 flex items-center justify-center z-50">
                <Card className="w-[300px]">
                  <CardContent className="py-6">
                    <div className="flex flex-col items-center space-y-4">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      >
                        <Settings className="h-8 w-8 text-blue-500" />
                      </motion.div>
                      <p className="text-sm text-center">
                        Änderungen werden gespeichert...
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}