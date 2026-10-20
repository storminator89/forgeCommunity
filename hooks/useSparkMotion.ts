'use client';

import { useSyncExternalStore } from 'react';

const journeyKey = 'forge-journey-motion-off';
const journeyEvent = 'forge-journey-motion-change';
const communityKey = 'forge-community-motion-off';
const communityEvent = 'forge-community-motion-change';
let journeyEnabled = true;
let journeyMemoryOnly = false;
let communityEnabled = true;
let communityMemoryOnly = false;

export function journeyMotionSnapshot() {
  if (journeyMemoryOnly) return journeyEnabled;
  try { journeyEnabled = window.localStorage.getItem(journeyKey) !== 'true'; }
  catch { /* Retain the last document-local choice. */ }
  return journeyEnabled;
}

export function communityMotionSnapshot() {
  if (communityMemoryOnly) return communityEnabled;
  try { communityEnabled = window.localStorage.getItem(communityKey) !== 'true'; }
  catch { /* Retain the last document-local choice. */ }
  return communityEnabled;
}

function subscribeJourney(callback: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== journeyKey) return;
    journeyEnabled = event.newValue !== 'true';
    journeyMemoryOnly = false;
    callback();
  };
  window.addEventListener('storage', storage);
  window.addEventListener(journeyEvent, callback);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(journeyEvent, callback);
  };
}

function subscribeCommunity(callback: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== communityKey) return;
    communityEnabled = event.newValue !== 'true';
    communityMemoryOnly = false;
    callback();
  };
  const changed = (event: Event) => {
    // FriendlyMotion broadcasts the explicit choice even when storage denies
    // a write. Do not replace that choice with a stale stored opt-in later.
    if (event instanceof CustomEvent && typeof event.detail === 'boolean') {
      communityEnabled = !event.detail;
      communityMemoryOnly = true;
    }
    callback();
  };
  window.addEventListener('storage', storage);
  window.addEventListener(communityEvent, changed);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(communityEvent, changed);
  };
}

export function setJourneyMotionEnabled(enabled: boolean) {
  journeyEnabled = enabled;
  try {
    window.localStorage.setItem(journeyKey, String(!enabled));
    journeyMemoryOnly = false;
  } catch { journeyMemoryOnly = true; }
  window.dispatchEvent(new Event(journeyEvent));
}

export function setCommunityMotionEnabled(enabled: boolean) {
  communityEnabled = enabled;
  try {
    window.localStorage.setItem(communityKey, String(!enabled));
    communityMemoryOnly = false;
  } catch { communityMemoryOnly = true; }
  window.dispatchEvent(new CustomEvent(communityEvent, { detail: !enabled }));
}

export function useJourneyMotion() {
  return useSyncExternalStore(subscribeJourney, journeyMotionSnapshot, () => false);
}

export function useCommunityMotion() {
  return useSyncExternalStore(subscribeCommunity, communityMotionSnapshot, () => false);
}

/** Spark never opts someone back in through a second page's motion setting. */
export function sparkMotionSnapshot() {
  return journeyMotionSnapshot() && communityMotionSnapshot();
}

export function useSparkMotion() {
  const journey = useJourneyMotion();
  const community = useCommunityMotion();
  return journey && community;
}
