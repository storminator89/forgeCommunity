// components/TagSelect.tsx
import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from 'lucide-react';

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
      <Label htmlFor={isAdding ? 'new-tag' : 'tags'} className="text-sm font-medium">Tags (max. {maxTags})</Label>
      <div className="flex flex-wrap gap-2" aria-label="Ausgewählte Tags">
        {selectedTags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onTagRemove(tag)}
            aria-label={`Tag ${tag} entfernen`}
            className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-border bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="min-w-0 break-all text-left">{tag}</span>
            <X className="h-4 w-4 shrink-0" aria-hidden="true" />
          </button>
        ))}
      </div>
      {!isAdding ? (
        <div className="flex min-w-0 items-center gap-2">
          <select
            id="tags"
            value=""
            onChange={(e) => {
              if (e.target.value && selectedTags.length < maxTags) {
                onTagSelect(e.target.value);
                e.target.value = '';
              }
            }}
            className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
            aria-label="Neuen Tag erstellen"
            disabled={selectedTags.length >= maxTags}
          >
            Neu
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Input
            id="new-tag"
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddTag();
              }
            }}
            placeholder="Neuen Tag eingeben..."
            className="w-full"
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
