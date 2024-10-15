// components/TagSelect.tsx
import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface TagSelectProps {
  availableTags: string[];
  selectedTags: string[];
  onTagSelect: (tag: string) => void;
  onTagRemove: (tag: string) => void;
  onAddTag: (tag: string) => void;
}

export const TagSelect: React.FC<TagSelectProps> = ({
  availableTags,
  selectedTags,
  onTagSelect,
  onTagRemove,
  onAddTag,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newTag, setNewTag] = useState('');

  const handleAddTag = () => {
    const trimmedTag = newTag.trim();
    if (trimmedTag && !availableTags.includes(trimmedTag)) {
      onAddTag(trimmedTag);
      setNewTag('');
      setIsAdding(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="tags" className="text-xl font-semibold block">Tags (max. 5)</Label>
      <div className="flex flex-wrap gap-2 mb-2">
        {selectedTags.map((tag) => (
          <Badge key={tag} variant="secondary" className="text-sm py-1 px-2">
            {tag}
            <button onClick={() => onTagRemove(tag)} className="ml-1 text-xs">
              &times;
            </button>
          </Badge>
        ))}
      </div>
      {!isAdding ? (
        <div className="flex items-center space-x-2">
          <select
            id="tags"
            value=""
            onChange={(e) => onTagSelect(e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring focus:border-blue-300"
          >
            <option value="" disabled>Wähle einen Tag...</option>
            {availableTags.filter(tag => !selectedTags.includes(tag)).map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
          <Button type="button" onClick={() => setIsAdding(true)}>
            Neuen hinzufügen
          </Button>
        </div>
      ) : (
        <div className="flex items-center space-x-2">
          <Input
            id="new-tag"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Neuen Tag eingeben..."
            className="flex-grow"
          />
          <Button type="button" onClick={handleAddTag}>
            Hinzufügen
          </Button>
          <Button variant="ghost" type="button" onClick={() => { setIsAdding(false); setNewTag(''); }}>
            Abbrechen
          </Button>
        </div>
      )}
    </div>
  );
};