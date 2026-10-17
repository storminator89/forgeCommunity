type Work = () => unknown;

export type DeferredCaptureErrors = Readonly<{
  collect(label: string, capture: Work, cleanup: Work): Promise<void>;
  finishWith<T>(core: () => T | Promise<T>): Promise<T>;
}>;

/** Keep evidence failures fatal without skipping independent functional checks. */
export function createDeferredCaptureErrors(): DeferredCaptureErrors {
  const failures: { label: string; phase: 'capture' | 'cleanup' | 'core'; error: unknown }[] = [];

  return Object.freeze({
    async collect(label: string, capture: Work, cleanup: Work): Promise<void> {
      try {
        await capture();
      } catch (error) {
        failures.push({ label, phase: 'capture', error });
      } finally {
        try {
          await cleanup();
        } catch (error) {
          failures.push({ label, phase: 'cleanup', error });
        }
      }
    },

    async finishWith<T>(core: () => T | Promise<T>): Promise<T> {
      let result!: T;
      try {
        result = await core();
      } catch (error) {
        failures.push({ label: 'functional checks', phase: 'core', error });
      }

      // Never clear failures or expose their backing array to callers.
      if (failures.length === 1) throw failures[0].error;
      if (failures.length > 1) {
        throw new AggregateError(
          failures.map(({ error }) => error),
          `Deferred test failures: ${failures.map(({ label, phase }) => `${label} (${phase})`).join('; ')}`,
        );
      }
      return result;
    },
  });
}
