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
      <Label htmlFor="category" className="text-sm font-medium">Kategorie</Label>
      {!isAdding ? (
        <div className="flex items-center gap-3">
          <select
            id="category"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="" disabled>Wähle eine Kategorie...</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <Button 
            type="button" 
            onClick={() => setIsAdding(true)}
            variant="outline"
            size="sm"
          >
            Neu
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Neue Kategorie eingeben..."
            className="w-full h-10 text-base"
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
