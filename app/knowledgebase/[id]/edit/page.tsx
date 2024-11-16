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

const QuillEditor = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';

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
    <div className="flex flex-col lg:flex-row min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-card shadow-sm z-10 sticky top-0 border-b">
          <div className="container mx-auto px-6 py-3 flex flex-col sm:flex-row items-center justify-between">
            <div className="flex items-center space-x-4">
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
              <h1 className="text-lg font-medium text-foreground hidden sm:block">
                Artikel bearbeiten
              </h1>
            </div>
            <div className="flex items-center space-x-2">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-accent/5">
          <div className="container mx-auto py-8 px-6">
            <div className="max-w-5xl mx-auto">
              {error && (
                <Alert variant="destructive" className="mb-6 animate-in slide-in-from-top-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              
              <div className="grid gap-6">
                <form onSubmit={handleSubmit}>
                  {/* Titel */}
                  <Card className="p-6 sm:p-8 shadow-sm mb-6 group hover:shadow-md transition-all">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label 
                          htmlFor="title" 
                          className="text-lg font-semibold text-foreground flex items-center gap-2"
                        >
                          <span>Titel</span>
                          <span className="text-xs text-muted-foreground font-normal">Erforderlich</span>
                        </Label>
                        <span className="text-xs text-muted-foreground">
                          {title.length}/100 Zeichen
                        </span>
                      </div>
                      <Input
                        id="title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="text-lg py-2.5 px-3 bg-background transition-colors focus:ring-2 ring-offset-2 ring-primary/20"
                        placeholder="Gib einen aussagekräftigen Titel ein..."
                        maxLength={100}
                        required
                      />
                    </div>
                  </Card>

                  {/* Beitragsbild */}
                  <Card className="p-6 sm:p-8 shadow-sm mb-6 group hover:shadow-md transition-all">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label 
                          htmlFor="featuredImage" 
                          className="text-lg font-semibold text-foreground flex items-center gap-2"
                        >
                          <span>Beitragsbild</span>
                          <span className="text-xs text-muted-foreground font-normal">Optional</span>
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
                            variant="outline"
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
                          <div className="relative w-full sm:w-[400px] aspect-video rounded-lg overflow-hidden bg-accent/10 group/image">
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
                              Entfernen
                            </Button>
                          </div>
                        ) : (
                          <div className="w-full sm:w-[400px] aspect-video rounded-lg border-2 border-dashed border-muted-foreground/20 flex items-center justify-center">
                            <p className="text-sm text-muted-foreground">Noch kein Bild ausgewählt</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>

                  {/* Inhalt */}
                  <Card className="p-6 sm:p-8 shadow-sm mb-6 group hover:shadow-md transition-all">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label 
                          htmlFor="content" 
                          className="text-lg font-semibold text-foreground flex items-center gap-2"
                        >
                          <span>Inhalt</span>
                          <span className="text-xs text-muted-foreground font-normal">Erforderlich</span>
                        </Label>
                      </div>
                      <div className="border rounded-lg overflow-hidden bg-background">
                        <QuillEditor
                          value={content}
                          onChange={setContent}
                          modules={{
                            toolbar: [
                              [{ 'header': [1, 2, 3, false] }],
                              ['bold', 'italic', 'underline', 'strike'],
                              [{'list': 'ordered'}, {'list': 'bullet'}],
                              ['link', 'image', 'code-block'],
                              ['clean']
                            ],
                          }}
                          className="min-h-[400px]"
                          placeholder="Schreibe hier deinen Artikel..."
                        />
                      </div>
                    </div>
                  </Card>

                  {/* Kategorie und Tags */}
                  <Card className="p-6 sm:p-8 shadow-sm mb-6 group hover:shadow-md transition-all">
                    <div className="space-y-8">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <Label className="text-lg font-semibold text-foreground flex items-center gap-2">
                            <span>Kategorie</span>
                            <span className="text-xs text-muted-foreground font-normal">Erforderlich</span>
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
                          <Label className="text-lg font-semibold text-foreground flex items-center gap-2">
                            <span>Tags</span>
                            <span className="text-xs text-muted-foreground font-normal">
                              {tags.length}/5 Tags
                            </span>
                          </Label>
                        </div>
                        <TagSelect
                          availableTags={existingTags}
                          selectedTags={tags}
                          onTagSelect={handleAddTag}
                          onTagRemove={handleRemoveTag}
                          onAddTag={handleAddNewTag}
                        />
                        <p className="text-xs text-muted-foreground">
                          Füge bis zu 5 Tags hinzu, um deinen Artikel besser auffindbar zu machen
                        </p>
                      </div>
                    </div>
                  </Card>

                  {/* Submit Button */}
                  <div className="sticky bottom-0 bg-background/80 backdrop-blur-sm py-4 border-t mt-6">
                    <div className="max-w-5xl mx-auto flex justify-end gap-3">
                      <Button 
                        type="button"
                        variant="outline"
                        size="lg"
                        className="px-6"
                        onClick={() => router.push(`/knowledgebase/${id}`)}
                      >
                        Abbrechen
                      </Button>
                      <Button 
                        type="submit"
                        size="lg"
                        className="px-8 font-medium hover:bg-primary/90 transition-colors"
                      >
                        Artikel aktualisieren
                      </Button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}