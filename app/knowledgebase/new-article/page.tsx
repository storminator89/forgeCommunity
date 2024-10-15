'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';
import { Sidebar } from "@/components/Sidebar";
import { UserNav } from "@/components/user-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BookOpen, ArrowLeft, Image, Upload } from 'lucide-react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { CategorySelect } from "@/components/CategorySelect";
import { TagSelect } from "@/components/TagSelect";

const QuillEditor = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';

export default function NewArticle() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [featuredImage, setFeaturedImage] = useState<File | null>(null);
  const [featuredImagePreview, setFeaturedImagePreview] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alert, setAlert] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      router.push('/login');
    }
  }, [session, status, router]);

  useEffect(() => {
    const fetchCategoriesAndTags = async () => {
      setIsLoading(true);
      try {
        const response = await fetch('/api/articles/categories-and-tags');
        if (response.ok) {
          const data = await response.json();
          setExistingCategories(data.categories || []);
          setExistingTags(data.tags || []);
        } else {
          console.error('Failed to fetch categories and tags');
          setExistingCategories([]);
          setExistingTags([]);
        }
      } catch (error) {
        console.error('Error fetching categories and tags:', error);
        setExistingCategories([]);
        setExistingTags([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCategoriesAndTags();
  }, []);

  const handleAddTag = (tag: string) => {
    if (!tags.includes(tag) && tags.length < 5) {
      setTags([...tags, tag]);
    } else if (tags.length >= 5) {
      setAlert({ message: 'Maximal 5 Tags erlaubt.', type: 'error' });
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
    setIsSubmitting(true);
  
    if (!title || !content || !category) {
      setAlert({ message: 'Titel, Inhalt und Kategorie sind erforderlich.', type: 'error' });
      setIsSubmitting(false);
      return;
    }
  
    const formData = new FormData();
    formData.append('title', title);
    formData.append('content', content);
    formData.append('category', category);
    tags.forEach(tag => formData.append('tags', tag));
    if (featuredImage) {
      formData.append('featuredImage', featuredImage);
    }
  
    try {
      const response = await fetch('/api/articles', {
        method: 'POST',
        body: formData,
      });
  
      if (response.ok) {
        const article = await response.json();
        setAlert({ message: 'Artikel erfolgreich erstellt!', type: 'success' });
        setTimeout(() => router.push(`/knowledgebase/${article.id}`), 2000);
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Fehler beim Erstellen des Artikels.');
      }
    } catch (error) {
      console.error('Error creating article:', error);
      setAlert({ message: error instanceof Error ? error.message : 'Fehler beim Erstellen des Artikels.', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <div>Laden...</div>;
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center justify-between">
            <h2 className="text-3xl font-bold text-gray-800 dark:text-white flex items-center">
              <BookOpen className="mr-2 h-6 w-6" />
              Neuer Artikel erstellen
            </h2>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6 lg:p-10">
          <Card className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <Button
                  variant="outline"
                  onClick={() => router.push('/knowledgebase')}
                  className="bg-black text-white hover:bg-gray-800 hover:text-white"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Zurück zur Übersicht
                </Button>
              </div>
              {alert && (
                <Alert variant={alert.type === 'error' ? 'destructive' : 'default'} className="mb-6">
                  <AlertDescription>{alert.message}</AlertDescription>
                </Alert>
              )}
              <ScrollArea className="h-[calc(100vh-250px)]">
                <form onSubmit={handleSubmit} className="space-y-8">
                  <div className="space-y-2">
                    <Label htmlFor="title" className="text-xl font-semibold">Titel</Label>
                    <Input
                      id="title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="text-lg py-2"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="featuredImage" className="text-xl font-semibold">Beitragsbild</Label>
                    <div className="flex items-center space-x-2">
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
                        className="flex items-center"
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        Bild auswählen
                      </Button>
                      {featuredImagePreview && (
                        <div className="w-16 h-16 border rounded-md overflow-hidden">
                          <img src={featuredImagePreview} alt="Vorschau" className="w-full h-full object-cover" />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="content" className="text-xl font-semibold">Inhalt</Label>
                    <div className="h-96 border rounded-md overflow-hidden">
                      <QuillEditor
                        value={content}
                        onChange={setContent}
                        modules={{
                          toolbar: [
                            [{ 'header': [1, 2, 3, false] }],
                            ['bold', 'italic', 'underline', 'strike'],
                            [{'list': 'ordered'}, {'list': 'bullet'}],
                            ['link', 'image'],
                            ['clean']
                          ],
                        }}
                        className="h-full"
                      />
                    </div>
                  </div>
                  <div className="space-y-2 mt-12">
                    <CategorySelect
                      categories={existingCategories}
                      selectedCategory={category}
                      setSelectedCategory={setCategory}
                      onAddCategory={handleAddNewCategory}
                    />
                  </div>
                  <div className="space-y-2">
                    <TagSelect
                      availableTags={existingTags}
                      selectedTags={tags}
                      onTagSelect={handleAddTag}
                      onTagRemove={handleRemoveTag}
                      onAddTag={handleAddNewTag}
                    />
                  </div>
                  <Separator className="my-6" />
                  <div className="flex justify-end">
                    <Button type="submit" disabled={isSubmitting} className="px-6 py-2 text-lg">
                      {isSubmitting ? 'Wird erstellt...' : 'Artikel veröffentlichen'}
                    </Button>
                  </div>
                </form>
              </ScrollArea>
            </div>
          </Card>
        </main>
      </div>
    </div>
  );
}