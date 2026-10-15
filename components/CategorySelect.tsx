// components/CategorySelect.tsx
import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CategorySelectProps {
  categories: string[];
  selectedCategory: string;
  setSelectedCategory: (category: string) => void;
  onAddCategory: (category: string) => void;
}

export const CategorySelect: React.FC<CategorySelectProps> = ({
  categories,
  selectedCategory,
  setSelectedCategory,
  onAddCategory,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const options = selectedCategory && !categories.includes(selectedCategory)
    ? [selectedCategory, ...categories]
    : categories;

  const handleAddCategory = () => {
    const trimmedCategory = newCategory.trim();
    if (trimmedCategory && !categories.includes(trimmedCategory)) {
      onAddCategory(trimmedCategory);
      setNewCategory('');
      setIsAdding(false);
    }
  };

  return (
    <div className="space-y-3">
      <Label htmlFor={isAdding ? 'new-category' : 'category'} className="text-sm font-medium">Kategorie</Label>
      {!isAdding ? (
        <div className="flex min-w-0 items-center gap-2">
          <select
            id="category"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
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
            Neu
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Input
            id="new-category"
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddCategory();
              }
            }}
            placeholder="Neue Kategorie eingeben..."
            className="w-full"
          />
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
              onClick={() => {
                setIsAdding(false);
                setNewCategory('');
              }}
              variant="outline"
              size="default"
              className="flex-1"
            >
              Abbrechen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
