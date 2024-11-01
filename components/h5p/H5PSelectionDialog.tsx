'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"; // Using relative path
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Search, Box } from 'lucide-react'; // Changed from Cube to Box

interface H5PContentType {
  id: string;
  title: string;
  description: string;
  category: string;
}

const H5P_CONTENT_TYPES: H5PContentType[] = [
  {
    id: 'interactive-video',
    title: 'Interactive Video',
    description: 'Create videos enriched with interactions',
    category: 'Media'
  },
  {
    id: 'course-presentation',
    title: 'Course Presentation',
    description: 'Create a slide-based presentation',
    category: 'Presentation'
  },
  {
    id: 'question-set',
    title: 'Question Set',
    description: 'Create a sequence of various question types',
    category: 'Assessment'
  },
  {
    id: 'drag-and-drop',
    title: 'Drag and Drop',
    description: 'Create drag and drop tasks with images',
    category: 'Games'
  },
  {
    id: 'memory-game',
    title: 'Memory Game',
    description: 'Create a classic memory game',
    category: 'Games'
  },
  {
    id: 'flashcards',
    title: 'Flashcards',
    description: 'Create stylish flashcards',
    category: 'Study Tools'
  },
  {
    id: 'timeline',
    title: 'Timeline',
    description: 'Create a timeline of events with multimedia',
    category: 'Media'
  }
];

interface H5PSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (content: { id: string, title: string }) => void;
}

export function H5PSelectionDialog({ open, onOpenChange, onSelect }: H5PSelectionDialogProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const categories = ['all', ...new Set(H5P_CONTENT_TYPES.map(type => type.category))];

  const filteredTypes = H5P_CONTENT_TYPES.filter(type => {
    const matchesSearch = type.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         type.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || type.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>H5P Inhalt auswählen</DialogTitle>
        </DialogHeader>
        
        <div className="flex gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <Input
              type="text"
              placeholder="H5P Inhaltstyp suchen..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 dark:bg-gray-800 dark:border-gray-600"
          >
            {categories.map(category => (
              <option key={category} value={category}>
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-h-[60vh] overflow-y-auto">
          {filteredTypes.map((type) => (
            <div
              key={type.id}
              className="p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
              onClick={() => onSelect(type)}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 relative flex items-center justify-center bg-blue-100 dark:bg-blue-900 rounded-lg">
                  <Box className="h-6 w-6 text-blue-600 dark:text-blue-400" /> {/* Changed from Cube to Box */}
                </div>
                <h3 className="font-medium text-sm">{type.title}</h3>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400">{type.description}</p>
              <div className="mt-2">
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                  {type.category}
                </span>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
