// components/CategorySelect.tsx
import { useEffect, useRef, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CategorySelectProps {
  categories: string[];
  selectedCategory: string;
  setSelectedCategory: (category: string) => void;
  onAddCategory: (category: string) => void;
  error?: string;
}

export const CategorySelect: React.FC<CategorySelectProps> = ({
  categories,
  selectedCategory,
  setSelectedCategory,
  onAddCategory,
  error,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newCategoryError, setNewCategoryError] = useState('');
  const selectRef = useRef<HTMLSelectElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasAdding = useRef(false);
  const options = selectedCategory && !categories.includes(selectedCategory)
    ? [selectedCategory, ...categories]
    : categories;

  useEffect(() => {
    if (isAdding) inputRef.current?.focus();
    else if (wasAdding.current) selectRef.current?.focus();
    wasAdding.current = isAdding;
  }, [isAdding]);

  const handleAddCategory = () => {
    const trimmedCategory = newCategory.trim();
    if (!trimmedCategory) {
      setNewCategoryError('Gib einen Namen für die Kategorie ein.');
      inputRef.current?.focus();
      return;
    }
    const existing = options.find(category => category.toLocaleLowerCase('de') === trimmedCategory.toLocaleLowerCase('de'));
    if (existing) setSelectedCategory(existing);
    else onAddCategory(trimmedCategory);
    setNewCategory('');
    setNewCategoryError('');
    setIsAdding(false);
  };

  const cancelAdding = () => {
    setIsAdding(false);
    setNewCategory('');
    setNewCategoryError('');
  };

  return (
    <div className="space-y-3">
      <Label htmlFor={isAdding ? 'new-category' : 'category'} className="text-sm font-medium">Kategorie</Label>
      {options.length === 0 && <p id="category-empty-hint" className="text-sm leading-6 text-muted-foreground">Noch keine Kategorien vorhanden. Erstelle eine Kategorie für deinen Artikel.</p>}
      {!isAdding ? (
        <div className="flex min-w-0 items-center gap-2">
          <select
            id="category"
            ref={selectRef}
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={[options.length === 0 ? 'category-empty-hint' : '', error ? 'category-error' : ''].filter(Boolean).join(' ') || undefined}
            className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="" disabled>Wähle eine Kategorie...</option>
            {options.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <Button 
            type="button" 
            onClick={() => setIsAdding(true)}
            variant="outline"
            aria-label="Neue Kategorie erstellen"
          >
            {options.length === 0 ? 'Kategorie erstellen' : 'Neu'}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Input
            id="new-category"
            ref={inputRef}
            type="text"
            value={newCategory}
            onChange={(e) => { setNewCategory(e.target.value); setNewCategoryError(''); }}
            aria-invalid={Boolean(newCategoryError || error)}
            aria-describedby={[options.length === 0 ? 'category-empty-hint' : '', newCategoryError ? 'new-category-error' : '', error ? 'category-error' : ''].filter(Boolean).join(' ') || undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddCategory();
              }
              if (e.key === 'Escape') { e.preventDefault(); cancelAdding(); }
            }}
            placeholder="Neue Kategorie eingeben..."
            className="w-full"
          />
          {newCategoryError && <p id="new-category-error" role="alert" className="text-sm text-destructive">{newCategoryError}</p>}
          <div className="flex items-center gap-2">
            <Button 
              type="button" 
              onClick={handleAddCategory}
              size="default"
              className="flex-1"
            >
              Hinzufügen
            </Button>
            <Button 
              type="button" 
              onClick={cancelAdding}
              variant="outline"
              size="default"
              className="flex-1"
            >
              Abbrechen
            </Button>
          </div>
        </div>
      )}
      {error && <p id="category-error" role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
};
