'use client';

import { useSyncExternalStore } from 'react';

// Keep the existing browser preference shared between entry points and Journey.
const preferenceKey = 'forge-journey-mascot-hidden';
const changeEvent = 'forge-journey-mascot-visibility-change';
let fallbackVisible = true;
let memoryOnly = false;

export function sparkVisibilitySnapshot() {
  if (memoryOnly) return fallbackVisible;
  try {
    fallbackVisible = window.localStorage.getItem(preferenceKey) !== 'true';
  } catch { /* Use the last document-local choice when storage is unavailable. */ }
  return fallbackVisible;
}

function subscribe(callback: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== null && event.key !== preferenceKey) return;
    fallbackVisible = event.newValue !== 'true';
    memoryOnly = false;
    callback();
  };
  window.addEventListener('storage', storageChanged);
  window.addEventListener(changeEvent, callback);
  return () => {
    window.removeEventListener('storage', storageChanged);
    window.removeEventListener(changeEvent, callback);
  };
}

export function setSparkVisible(visible: boolean) {
  fallbackVisible = visible;
  try {
    window.localStorage.setItem(preferenceKey, String(!visible));
    memoryOnly = false;
  } catch {
    // A denied write must still work even if reading the old value is allowed.
    memoryOnly = true;
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function useSparkVisibility() {
  // Do not send an image in server HTML before checking a saved opt-out.
  const visible = useSyncExternalStore(subscribe, sparkVisibilitySnapshot, () => false);
  return { visible, toggle: () => setSparkVisible(!sparkVisibilitySnapshot()) };
}
