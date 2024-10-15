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
    <div className="space-y-2">
      <Label htmlFor="category" className="text-xl font-semibold block">Kategorie</Label>
      {!isAdding ? (
        <div className="flex items-center space-x-2">
          <select
            id="category"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring focus:border-blue-300"
          >
            <option value="" disabled>Wähle eine Kategorie...</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <Button type="button" onClick={() => setIsAdding(true)}>
            Neue hinzufügen
          </Button>
        </div>
      ) : (
        <div className="flex items-center space-x-2">
          <Input
            id="new-category"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Neue Kategorie eingeben..."
            className="flex-grow"
          />
          <Button type="button" onClick={handleAddCategory}>
            Hinzufügen
          </Button>
          <Button variant="ghost" type="button" onClick={() => { setIsAdding(false); setNewCategory(''); }}>
            Abbrechen
          </Button>
        </div>
      )}
    </div>
  );
};
