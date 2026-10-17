// Automatic reads belong only to the visible, focused, connected tab. Keep
// manual mutations separate: losing focus must never cancel a user's save.
export function isForegroundAvailable(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus() && navigator.onLine !== false;
}

export function startForegroundPolling({ poll, intervalMs, maxRetryMs = intervalMs }: {
  poll: (signal: AbortSignal) => Promise<boolean | void>;
  intervalMs: number;
  maxRetryMs?: number;
}): () => void {
  let disposed = false;
  let available = isForegroundAvailable();
  let inFlight = false;
  let refreshRequested = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = (delay: number) => {
    clearTimer();
    if (disposed || inFlight || !isForegroundAvailable()) return;
    timer = setTimeout(() => { timer = null; void run(); }, delay);
  };
  async function run() {
    if (disposed || inFlight || !isForegroundAvailable()) return;
    inFlight = true;
    refreshRequested = false;
    const currentController = new AbortController();
    controller = currentController;
    let success = false;
    try {
      success = await poll(currentController.signal) !== false;
    } catch (error) {
      if (!currentController.signal.aborted) console.error('Error refreshing foreground data:', error);
    } finally {
      controller = null;
      inFlight = false;
      if (!currentController.signal.aborted) failures = success ? 0 : Math.min(failures + 1, 6);
      const delay = failures > 0
        ? Math.min(intervalMs * 2 ** (failures - 1), maxRetryMs)
        : intervalMs;
      schedule(refreshRequested ? 0 : delay);
    }
  }
  const onAvailabilityChange = () => {
    const nextAvailable = isForegroundAvailable();
    if (available === nextAvailable) return;
    available = nextAvailable;
    if (!available) {
      clearTimer();
      controller?.abort();
      return;
    }
    // focus and visibilitychange often arrive together. Only the transition
    // queues a read, including when an aborted request is still settling.
    failures = 0;
    refreshRequested = true;
    if (!inFlight) schedule(0);
  };

  document.addEventListener('visibilitychange', onAvailabilityChange);
  window.addEventListener('focus', onAvailabilityChange);
  window.addEventListener('blur', onAvailabilityChange);
  window.addEventListener('online', onAvailabilityChange);
  window.addEventListener('offline', onAvailabilityChange);
  schedule(0);

  return () => {
    disposed = true;
    clearTimer();
    controller?.abort();
    document.removeEventListener('visibilitychange', onAvailabilityChange);
    window.removeEventListener('focus', onAvailabilityChange);
    window.removeEventListener('blur', onAvailabilityChange);
    window.removeEventListener('online', onAvailabilityChange);
    window.removeEventListener('offline', onAvailabilityChange);
  };
}
