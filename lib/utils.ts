import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date));
}

export function getRandomGradient(): string {
  const gradients = [
    'bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500',
    'bg-gradient-to-r from-green-300 via-blue-500 to-purple-600',
    'bg-gradient-to-r from-pink-300 via-purple-300 to-indigo-400',
    'bg-gradient-to-r from-yellow-200 via-green-200 to-green-500',
    'bg-gradient-to-r from-blue-300 to-blue-600',
    'bg-gradient-to-r from-red-200 via-red-300 to-yellow-200',
  ];
  
  return gradients[Math.floor(Math.random() * gradients.length)];
}
