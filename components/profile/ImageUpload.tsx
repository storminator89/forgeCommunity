"use client";

import { useState, useRef } from 'react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Camera, Loader2, Upload } from 'lucide-react';
import { toast } from 'react-toastify';
import Image from 'next/image';

interface ImageUploadProps {
  userId: string;
  type: 'avatar' | 'cover';
  currentImage?: string | null;
  onUpdate: (imageUrl: string) => void;
  children?: React.ReactNode;
}

export function ImageUpload({ userId, type, currentImage, onUpdate, children }: ImageUploadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Datei ist zu groß (max. 5MB)');
        return;
      }

      if (!file.type.startsWith('image/')) {
        toast.error('Nur Bilder sind erlaubt');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setIsLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);

    try {
      const response = await fetch(`/api/users/${userId}/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      onUpdate(data.url);
      toast.success(`${type === 'avatar' ? 'Profilbild' : 'Titelbild'} erfolgreich aktualisiert`);
      setIsOpen(false);
    } catch (error) {
      console.error('Error uploading image:', error);
      toast.error('Fehler beim Hochladen des Bildes');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button
            variant="ghost"
            size="sm"
            className={type === 'cover' ? 'absolute top-4 right-4' : 'absolute bottom-0 right-0'}
          >
            <Camera className="h-4 w-4 mr-2" />
            {type === 'avatar' ? 'Profilbild ändern' : 'Titelbild ändern'}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>
            {type === 'avatar' ? 'Profilbild hochladen' : 'Titelbild hochladen'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="image">Bild auswählen</Label>
            <input
              id="image"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              ref={fileInputRef}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="w-full"
            >
              <Upload className="mr-2 h-4 w-4" />
              Bild auswählen
            </Button>
          </div>

          {(preview || currentImage) && (
            <div className="relative aspect-[3/1]">
              <Image
                src={preview || currentImage || ''}
                alt="Preview"
                fill
                className="object-cover rounded-lg"
              />
            </div>
          )}

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isLoading}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleUpload}
              disabled={!preview || isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Hochladen...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Hochladen
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}