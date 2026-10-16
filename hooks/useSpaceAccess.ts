'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SpaceHttpError, spaceJson } from '@/components/spaces/space-api';

/** One viewer/space owns one request scope. Losing access invalidates every in-flight read. */
export function useSpaceAccess(onAccessLost?: () => void) {
  const [accessLost, setAccessLost] = useState(false);
  const invalidRef = useRef(false);
  const epochRef = useRef(0);
  const requestsRef = useRef(new Set<AbortController>());
  const onAccessLostRef = useRef(onAccessLost);
  useEffect(() => { onAccessLostRef.current = onAccessLost; }, [onAccessLost]);

  const invalidate = useCallback(() => {
    if (invalidRef.current) return;
    invalidRef.current = true;
    epochRef.current += 1;
    requestsRef.current.forEach(controller => controller.abort());
    requestsRef.current.clear();
    onAccessLostRef.current?.();
    setAccessLost(true);
  }, []);

  useEffect(() => () => {
    invalidRef.current = true;
    epochRef.current += 1;
    requestsRef.current.forEach(controller => controller.abort());
    requestsRef.current.clear();
  }, []);

  const request = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    if (invalidRef.current) throw new DOMException('Access changed', 'AbortError');
    const epoch = epochRef.current;
    const controller = new AbortController();
    const externalSignal = init.signal;
    const abortFromCaller = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
    requestsRef.current.add(controller);
    try {
      const data = await spaceJson<T>(path, { ...init, signal: controller.signal });
      if (controller.signal.aborted || epoch !== epochRef.current || invalidRef.current) {
        throw new DOMException('Access changed', 'AbortError');
      }
      return data;
    } catch (error) {
      if (controller.signal.aborted || epoch !== epochRef.current || invalidRef.current) {
        throw new DOMException('Access changed', 'AbortError');
      }
      if (error instanceof SpaceHttpError && (error.status === 403 || error.status === 404)) invalidate();
      throw error;
    } finally {
      externalSignal?.removeEventListener('abort', abortFromCaller);
      requestsRef.current.delete(controller);
    }
  }, [invalidate]);

  return { accessLost, invalidate, request };
}

/** A newer list read supersedes pagination and revalidation, even if transport ignores abort. */
export function useSpaceListGeneration() {
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    generationRef.current += 1;
    controllerRef.current?.abort();
  }, []);

  return useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    const generation = generationRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    return {
      signal: controller.signal,
      isCurrent: () => generationRef.current === generation && !controller.signal.aborted,
    };
  }, []);
}
