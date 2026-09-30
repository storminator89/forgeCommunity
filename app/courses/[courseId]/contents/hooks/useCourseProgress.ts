'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface CourseEnrollment {
  id: string;
  enrolledAt: string;
  completedAt: string | null;
}

export interface CourseProgressState {
  enrollment: CourseEnrollment;
  completedContentIds: string[];
  learningContentIds: string[];
  requiredContentIds: string[];
  completedCount: number;
  requiredCount: number;
  percentage: number;
  certificate: { id: string; issuedAt: string } | null;
}

export async function courseRequestError(response: Response, fallback: string): Promise<Error> {
  try {
    const data = await response.json();
    if (typeof data.error === 'string') return new Error(`${fallback} (${data.error})`);
  } catch {
    // Non-JSON errors still need a visible, actionable fallback.
  }
  return new Error(fallback);
}

export function useCourseProgress(courseId: string, enabled: boolean) {
  const [progress, setProgress] = useState<CourseProgressState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingContentId, setSavingContentId] = useState<string | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const version = useRef(0);
  const saving = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || saving.current) return;
    const controller = new AbortController();
    controllers.current.add(controller);
    const requestVersion = ++version.current;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/courses/${courseId}/progress`, {
        signal: controller.signal, cache: 'no-store',
      });
      if (!response.ok) throw await courseRequestError(response, 'Fortschritt konnte nicht geladen werden. Bitte erneut versuchen.');
      const data = await response.json() as CourseProgressState;
      if (!controller.signal.aborted && requestVersion === version.current) setProgress(data);
    } catch (cause) {
      if (!controller.signal.aborted && requestVersion === version.current) {
        setError(cause instanceof Error ? cause.message : 'Fortschritt konnte nicht geladen werden.');
      }
    } finally {
      controllers.current.delete(controller);
      if (!controller.signal.aborted && requestVersion === version.current) setIsLoading(false);
    }
  }, [courseId, enabled]);

  useEffect(() => {
    const activeControllers = controllers.current;
    saving.current = false;
    // The component is keyed by course and account; reset on hook input changes too.
    // This is a server synchronization boundary, not derived display state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(null);
    setError(null);
    setSavingContentId(null);
    setIsLoading(enabled);
    void refresh();
    return () => {
      activeControllers.forEach(controller => controller.abort());
      activeControllers.clear();
      version.current += 1;
    };
  }, [refresh, enabled]);

  const setCompleted = useCallback(async (contentId: string, completed: boolean) => {
    if (!enabled || saving.current || !progress || progress.enrollment.completedAt) return;
    saving.current = true;
    setSavingContentId(contentId);
    setError(null);
    const controller = new AbortController();
    controllers.current.add(controller);
    // Invalidate any older read; only the confirmed write can update the display.
    const requestVersion = ++version.current;
    setIsLoading(false);
    try {
      const response = await fetch(`/api/courses/${courseId}/contents/${contentId}/progress`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }), signal: controller.signal,
      });
      if (!response.ok) throw await courseRequestError(response, 'Fortschritt wurde nicht gespeichert. Bitte erneut versuchen.');
      const data = await response.json() as CourseProgressState;
      if (!controller.signal.aborted && requestVersion === version.current) setProgress(data);
    } catch (cause) {
      if (!controller.signal.aborted && requestVersion === version.current) {
        setError(cause instanceof Error ? cause.message : 'Fortschritt wurde nicht gespeichert.');
      }
    } finally {
      controllers.current.delete(controller);
      if (!controller.signal.aborted) {
        saving.current = false;
        setSavingContentId(null);
      }
    }
  }, [courseId, enabled, progress]);

  return { progress: enabled ? progress : null, isLoading, error, savingContentId, refresh, setCompleted };
}
