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

export function getRandomGradient() {
  const gradients = [
    { from: '#ec4899', to: '#eab308' }, // pink-500 to yellow-500
    { from: '#86efac', to: '#9333ea' }, // green-300 to purple-600
    { from: '#f9a8d4', to: '#818cf8' }, // pink-300 to indigo-400
    { from: '#fef08a', to: '#22c55e' }, // yellow-200 to green-500
    { from: '#93c5fd', to: '#2563eb' }, // blue-300 to blue-600
    { from: '#fecaca', to: '#fef08a' }, // red-200 to yellow-200
  ];

  return gradients[Math.floor(Math.random() * gradients.length)];
}
