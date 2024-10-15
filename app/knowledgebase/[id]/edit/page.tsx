'use client';

import { useState, useEffect } from 'react';
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
import { AlertCircle, ArrowLeft, BookOpen } from 'lucide-react';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CategorySelect } from "@/components/CategorySelect";
import { TagSelect } from "@/components/TagSelect";

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
  author: Author;
  createdAt: string;
  tags: Tag[];
}

export default function EditArticle() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const { id } = params;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState<string[]>([]);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title || !content || !category) {
      setError('Titel, Inhalt und Kategorie sind erforderlich.');
      return;
    }

    try {
      const response = await fetch(`/api/articles/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, content, category, tags }),
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
    <div className="flex flex-col lg:flex-row min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-gray-800 shadow-md z-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white flex items-center mb-4 sm:mb-0">
              <BookOpen className="mr-2 h-6 w-6" />
              Artikel bearbeiten
            </h1>
            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <UserNav />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <Card className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-lg">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <Button
                  variant="outline"
                  onClick={() => router.push(`/knowledgebase/${id}`)}
                  className="bg-black text-white hover:bg-gray-800 hover:text-white"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" /> Zurück zum Artikel
                </Button>
              </div>
              {error && (
                <Alert variant="destructive" className="mb-6">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
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
                    <Button type="submit" className="px-6 py-2 text-lg">
                      Artikel aktualisieren
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