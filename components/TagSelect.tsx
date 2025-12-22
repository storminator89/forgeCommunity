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
  maxTags?: number;
}

export const TagSelect: React.FC<TagSelectProps> = ({
  availableTags,
  selectedTags,
  onTagSelect,
  onTagRemove,
  onAddTag,
  maxTags = 5,
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
    <div className="space-y-3">
      <Label htmlFor="tags" className="text-sm font-medium">Tags (max. {maxTags})</Label>
      <div className="flex flex-wrap gap-2 mb-3">
        {selectedTags.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="text-base py-1.5 px-3 hover:bg-secondary/80"
          >
            {tag}
            <button
              onClick={() => onTagRemove(tag)}
              className="ml-2 hover:text-destructive"
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
      {!isAdding ? (
        <div className="flex items-center gap-3">
          <select
            id="tags"
            value=""
            onChange={(e) => {
              if (e.target.value && selectedTags.length < maxTags) {
                onTagSelect(e.target.value);
                e.target.value = '';
              }
            }}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={selectedTags.length >= maxTags}
          >
            <option value="">Tag auswählen...</option>
            {availableTags
              .filter((tag) => !selectedTags.includes(tag))
              .map((tag) => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
          </select>
          <Button
            type="button"
            onClick={() => setIsAdding(true)}
            variant="outline"
            size="sm"
            disabled={selectedTags.length >= maxTags}
          >
            Neu
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Neuen Tag eingeben..."
            className="w-full h-10 text-base"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={handleAddTag}
              size="default"
              className="flex-1"
            >
              Hinzufügen
            </Button>
            <Button
              type="button"
              onClick={() => {
                setIsAdding(false);
                setNewTag('');
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