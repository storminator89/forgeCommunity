'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card } from "@/components/ui/card";
import { AlertCircle, ArrowLeft, BookOpen, Upload } from 'lucide-react';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CategorySelect } from "@/components/CategorySelect";
import { TagSelect } from "@/components/TagSelect";
import Image from 'next/image';
import { Type, ImageIcon, FileText, FolderOpen, Tags, Trash2, Save, Loader2 } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Editor } from "@/components/Editor";

interface Tag {
  id: string;
  name: string;
}

interface Author {
  id: string;
  name: string;
  email: string;
}

interface Article {
  id: string;
  title: string;
  content: string;
  category: string;
  featuredImage: string | null;
  author: Author;
  createdAt: string;
  tags: Tag[];
}

export default function EditArticle() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const { id } = params;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [featuredImage, setFeaturedImage] = useState<File | null>(null);
  const [featuredImagePreview, setFeaturedImagePreview] = useState<string>('');
  const [isImageDeleted, setIsImageDeleted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [existingTags, setExistingTags] = useState<string[]>([]);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
    }
  }, [session, status, router]);

  useEffect(() => {
    const fetchArticleAndMetadata = async () => {
      setIsLoading(true);
      try {
        const [articleResponse, metadataResponse] = await Promise.all([
          fetch(`/api/articles/${id}`),
          fetch('/api/articles/categories-and-tags')
        ]);

        if (!articleResponse.ok) {
          throw new Error(`HTTP error! status: ${articleResponse.status}`);
        }

        const articleData: Article = await articleResponse.json();
        setTitle(articleData.title);
        setContent(articleData.content);
        setCategory(articleData.category);
        setTags(articleData.tags.map(tag => tag.name));
        if (articleData.featuredImage) {
          setFeaturedImagePreview(articleData.featuredImage);
        }

        if (metadataResponse.ok) {
          const metadataData = await metadataResponse.json();
          setExistingCategories(metadataData.categories || []);
          setExistingTags(metadataData.tags || []);
        }
      } catch (error) {
        console.error('Error fetching article:', error);
        setError('Fehler beim Laden des Artikels.');
      } finally {
        setIsLoading(false);
      }
    };

    if (id) {
      fetchArticleAndMetadata();
    }
  }, [id]);

  const handleAddTag = (tag: string) => {
    if (!tags.includes(tag) && tags.length < 5) {
      setTags([...tags, tag]);
    } else if (tags.length >= 5) {
      setError('Maximal 5 Tags erlaubt.');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const handleAddNewTag = (newTag: string) => {
    if (!existingTags.includes(newTag)) {
      setExistingTags([...existingTags, newTag]);
    }
    handleAddTag(newTag);
  };

  const handleAddNewCategory = (newCategory: string) => {
    if (!existingCategories.includes(newCategory)) {
      setExistingCategories([...existingCategories, newCategory]);
    }
    setCategory(newCategory);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFeaturedImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setFeaturedImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title || !content || !category) {
      setError('Titel, Inhalt und Kategorie sind erforderlich.');
      return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('content', content);
    formData.append('category', category);
    tags.forEach(tag => formData.append('tags', tag));

    // Explizit markieren, wenn das Bild gelöscht werden soll
    formData.append('deleteImage', isImageDeleted.toString());

    if (featuredImage) {
      formData.append('featuredImage', featuredImage);
    }

    try {
      const response = await fetch(`/api/articles/${id}`, {
        method: 'PUT',
        body: formData,
      });

      if (response.ok) {
        router.push(`/knowledgebase/${id}`);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Fehler beim Aktualisieren des Artikels.');
      }
    } catch (error) {
      console.error('Error updating article:', error);
      setError(error instanceof Error ? error.message : 'Fehler beim Aktualisieren des Artikels.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Artikel wird geladen...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen">
        <header className="bg-card shadow-sm z-10 sticky top-0 border-b flex-none">
          <div className="container mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-4 w-full sm:w-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push(`/knowledgebase/${id}`)}
                className="hover:bg-accent transition-colors"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Zurück
              </Button>
              <div className="h-4 w-px bg-border hidden sm:block" />
              <h1 className="text-lg font-semibold text-foreground hidden sm:block">
                Artikel bearbeiten
              </h1>
            </div>
            <div className="flex items-center space-x-3">
              <Button
                type="submit"
                form="editForm"
                disabled={isLoading}
                className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
              >
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
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-gradient-to-b from-accent/5 to-background">
          <div className="container mx-auto py-8 px-6">
            <div className="max-w-4xl mx-auto">
              {error && (
                <Alert variant="destructive" className="mb-6 animate-in slide-in-from-top-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-6">
                <form id="editForm" onSubmit={handleSubmit} className="space-y-6">
                  {/* Titel */}
                  <Card className="p-6 shadow-sm transition-all border-muted">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label
                          htmlFor="title"
                          className="text-base font-medium text-foreground flex items-center gap-2"
                        >
                          <Type className="h-4 w-4" />
                          <span>Titel</span>
                          <Badge variant="secondary" className="ml-2 font-normal">
                            Erforderlich
                          </Badge>
                        </Label>
                        <span className={title.length > 90 ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
                          {title.length}/100 Zeichen
                        </span>
                      </div>
                      <Input
                        id="title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="text-lg py-2.5 px-3 bg-background/50 transition-colors focus-visible:ring-1 focus-visible:ring-primary"
                        placeholder="Gib einen aussagekräftigen Titel ein..."
                        maxLength={100}
                        required
                      />
                    </div>
                  </Card>

                  {/* Beitragsbild */}
                  <Card className="p-6 shadow-sm transition-all border-muted">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label
                          htmlFor="featuredImage"
                          className="text-base font-medium text-foreground flex items-center gap-2"
                        >
                          <ImageIcon className="h-4 w-4" />
                          <span>Beitragsbild</span>
                          <Badge variant="secondary" className="ml-2 font-normal">
                            Optional
                          </Badge>
                        </Label>
                      </div>
                      <div className="flex flex-col sm:flex-row items-start gap-6">
                        <div className="space-y-4 w-full sm:w-auto">
                          <input
                            type="file"
                            id="featuredImage"
                            ref={fileInputRef}
                            onChange={handleImageUpload}
                            accept="image/*"
                            className="hidden"
                          />
                          <Button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            variant="secondary"
                            className="w-full sm:w-auto group hover:bg-primary hover:text-primary-foreground transition-all duration-200"
                          >
                            <Upload className="mr-2 h-4 w-4 group-hover:scale-110 transition-transform" />
                            Bild auswählen
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            Empfohlene Größe: 1200x630px, Max. 5MB
                          </p>
                        </div>
                        {featuredImagePreview ? (
                          <div className="relative w-full sm:w-[400px] aspect-video rounded-lg overflow-hidden bg-accent/10 group/image ring-1 ring-border">
                            <Image
                              src={featuredImagePreview}
                              alt="Vorschau"
                              fill
                              className="object-cover transition-transform group-hover/image:scale-105"
                            />
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="absolute top-2 right-2 opacity-0 group-hover/image:opacity-100 transition-opacity"
                              onClick={() => {
                                setFeaturedImage(null);
                                setFeaturedImagePreview('');
                                setIsImageDeleted(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Entfernen
                            </Button>
                          </div>
                        ) : (
                          <div className="w-full sm:w-[400px] aspect-video rounded-lg border-2 border-dashed border-muted-foreground/20 bg-accent/5 flex items-center justify-center">
                            <div className="text-center text-muted-foreground">
                              <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                              <p className="text-sm">Noch kein Bild ausgewählt</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>

                  {/* Inhalt */}
                  <Card className="p-6 shadow-sm transition-all border-muted">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label
                          htmlFor="content"
                          className="text-base font-medium text-foreground flex items-center gap-2"
                        >
                          <FileText className="h-4 w-4" />
                          <span>Inhalt</span>
                          <Badge variant="secondary" className="ml-2 font-normal">
                            Erforderlich
                          </Badge>
                        </Label>
                      </div>
                      <div className="border rounded-lg overflow-hidden bg-background/50 focus-within:ring-1 focus-within:ring-primary transition-all">
                        <Editor
                          content={content}
                          onChange={setContent}
                          className="min-h-[400px]"
                        />
                      </div>
                    </div>
                  </Card>

                  {/* Kategorie und Tags */}
                  <Card className="p-6 shadow-sm transition-all border-muted">
                    <div className="space-y-8">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <Label className="text-base font-medium text-foreground flex items-center gap-2">
                            <FolderOpen className="h-4 w-4" />
                            <span>Kategorie</span>
                            <Badge variant="secondary" className="ml-2 font-normal">
                              Erforderlich
                            </Badge>
                          </Label>
                        </div>
                        <CategorySelect
                          categories={existingCategories}
                          selectedCategory={category}
                          setSelectedCategory={setCategory}
                          onAddCategory={handleAddNewCategory}
                        />
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <Label className="text-base font-medium text-foreground flex items-center gap-2">
                            <Tags className="h-4 w-4" />
                            <span>Tags</span>
                            <Badge
                              variant={tags.length >= 5 ? "destructive" : "secondary"}
                              className="ml-2 font-normal"
                            >
                              {tags.length}/5 Tags
                            </Badge>
                          </Label>
                        </div>
                        <TagSelect
                          availableTags={existingTags}
                          selectedTags={tags}
                          onTagSelect={handleAddTag}
                          onTagRemove={handleRemoveTag}
                          onAddTag={handleAddNewTag}
                          maxTags={5}
                        />
                        <p className="text-xs text-muted-foreground">
                          Tags helfen dabei, deinen Artikel besser auffindbar zu machen
                        </p>
                      </div>
                    </div>
                  </Card>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}