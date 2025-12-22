"use client";

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Github, Globe, Linkedin, Loader2, Save, Twitter } from 'lucide-react';
import { toast } from 'react-toastify';

interface SocialLinks {
  github?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  website?: string | null;
}

interface SocialLinksFormProps {
  userId: string;
  initialData: SocialLinks;
  onUpdate: (data: SocialLinks) => void;
}

export function SocialLinksForm({ userId, initialData, onUpdate }: SocialLinksFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<SocialLinks>(initialData);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch(`/api/users/${userId}/social`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error('Failed to update social links');
      }

      const data = await response.json();
      onUpdate(data.socialLinks);
      toast.success('Soziale Links erfolgreich aktualisiert');
      setIsOpen(false);
    } catch (error) {
      console.error('Error updating social links:', error);
      toast.error('Fehler beim Aktualisieren der sozialen Links');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Globe className="h-4 w-4 mr-2" />
          Soziale Links bearbeiten
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Soziale Links bearbeiten</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="github" className="flex items-center">
              <Github className="h-4 w-4 mr-2" />
              GitHub
            </Label>
            <Input
              id="github"
              type="url"
              value={formData.github || ''}
              onChange={(e) => setFormData({ ...formData, github: e.target.value })}
              placeholder="https://github.com/username"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="linkedin" className="flex items-center">
              <Linkedin className="h-4 w-4 mr-2" />
              LinkedIn
            </Label>
            <Input
              id="linkedin"
              type="url"
              value={formData.linkedin || ''}
              onChange={(e) => setFormData({ ...formData, linkedin: e.target.value })}
              placeholder="https://linkedin.com/in/username"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="twitter" className="flex items-center">
              <Twitter className="h-4 w-4 mr-2" />
              Twitter
            </Label>
            <Input
              id="twitter"
              type="url"
              value={formData.twitter || ''}
              onChange={(e) => setFormData({ ...formData, twitter: e.target.value })}
              placeholder="https://twitter.com/username"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="website" className="flex items-center">
              <Globe className="h-4 w-4 mr-2" />
              Website
            </Label>
            <Input
              id="website"
              type="url"
              value={formData.website || ''}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              placeholder="https://example.com"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isLoading}
            >
              Abbrechen
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Speichern...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Speichern
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}