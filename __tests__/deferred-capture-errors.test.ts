/** @jest-environment node */
import { createDeferredCaptureErrors } from '../e2e/deferred-capture-errors';

describe('deferred screenshot capture failures', () => {
  it('runs capture, cleanup, and functional checks in order and returns the functional result', async () => {
    const events: string[] = [];
    const captures = createDeferredCaptureErrors();

    await captures.collect('reader screenshot', async () => {
      events.push('capture');
    }, async () => {
      events.push('cleanup');
    });
    await expect(captures.finishWith(async () => {
      events.push('functional');
      return 'complete';
    })).resolves.toBe('complete');

    expect(events).toEqual(['capture', 'cleanup', 'functional']);
  });

  it('keeps a capture assertion fatal after cleanup and independent later flows', async () => {
    const failure = new Error('screenshot assertion failed');
    const events: string[] = [];
    const captures = createDeferredCaptureErrors();

    await expect(captures.collect('reader screenshot', async () => {
      events.push('capture');
      throw failure;
    }, async () => {
      events.push('cleanup');
    })).resolves.toBeUndefined();
    await expect(captures.finishWith(async () => {
      events.push('lost response', 'replay', 'revocation');
    })).rejects.toBe(failure);

    expect(events).toEqual(['capture', 'cleanup', 'lost response', 'replay', 'revocation']);
  });

  it('attempts every capture and cleanup, then aggregates all original capture failures after core', async () => {
    const failures = [new Error('desktop assertion'), new Error('mobile assertion')];
    const events: string[] = [];
    const captures = createDeferredCaptureErrors();

    for (const [index, label] of ['desktop', 'mobile'].entries()) {
      await captures.collect(label, async () => {
        events.push(`${label} capture`);
        throw failures[index];
      }, async () => {
        events.push(`${label} cleanup`);
      });
    }

    const result = captures.finishWith(async () => {
      events.push('functional');
    });
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    await expect(result).rejects.toMatchObject({
      message: 'Deferred test failures: desktop (capture); mobile (capture)',
      errors: [failures[0], failures[1]],
    });
    await result.catch((error: AggregateError) => {
      expect(error.errors[0]).toBe(failures[0]);
      expect(error.errors[1]).toBe(failures[1]);
    });
    expect(events).toEqual([
      'desktop capture', 'desktop cleanup', 'mobile capture', 'mobile cleanup', 'functional',
    ]);
  });

  it('retains a cleanup failure and still runs the functional checks', async () => {
    const failure = new Error('cleanup failed');
    const core = jest.fn(async () => undefined);
    const captures = createDeferredCaptureErrors();

    await captures.collect('reader screenshot', async () => undefined, async () => {
      throw failure;
    });
    await expect(captures.finishWith(core)).rejects.toBe(failure);

    expect(core).toHaveBeenCalledTimes(1);
  });

  it('retains capture and cleanup errors separately with their phases', async () => {
    const captureFailure = new Error('capture failed');
    const cleanupFailure = new Error('cleanup failed');
    const core = jest.fn(async () => undefined);
    const captures = createDeferredCaptureErrors();

    await captures.collect('reader screenshot', async () => {
      throw captureFailure;
    }, async () => {
      throw cleanupFailure;
    });
    const result = captures.finishWith(core);
    await expect(result).rejects.toMatchObject({
      message: 'Deferred test failures: reader screenshot (capture); reader screenshot (cleanup)',
      errors: [captureFailure, cleanupFailure],
    });
    expect(core).toHaveBeenCalledTimes(1);
  });

  it('rethrows an independent functional failure by identity', async () => {
    const failure = new Error('revocation assertion failed');
    const captures = createDeferredCaptureErrors();

    await captures.collect('reader screenshot', async () => undefined, async () => undefined);
    await expect(captures.finishWith(async () => {
      throw failure;
    })).rejects.toBe(failure);
  });

  it('keeps the capture assertion when independent functional checks also fail', async () => {
    const captureFailure = new Error('capture assertion failed');
    const coreFailure = new Error('revocation assertion failed');
    const cleanup = jest.fn(async () => undefined);
    const captures = createDeferredCaptureErrors();

    await captures.collect('reader screenshot', async () => {
      throw captureFailure;
    }, cleanup);
    const result = captures.finishWith(async () => {
      throw coreFailure;
    });
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    await result.catch((error: AggregateError) => {
      expect(error.errors).toHaveLength(2);
      expect(error.errors[0]).toBe(captureFailure);
      expect(error.errors[1]).toBe(coreFailure);
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('aggregates capture, cleanup, and functional failures without replacing any originals', async () => {
    const captureFailure = new Error('capture assertion failed');
    const cleanupFailure = new Error('cleanup failed');
    const coreFailure = new Error('replay assertion failed');
    const captures = createDeferredCaptureErrors();

    await captures.collect('reader screenshot', async () => {
      throw captureFailure;
    }, async () => {
      throw cleanupFailure;
    });
    const result = captures.finishWith(async () => {
      throw coreFailure;
    });
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    await expect(result).rejects.toMatchObject({
      message: 'Deferred test failures: reader screenshot (capture); reader screenshot (cleanup); functional checks (core)',
    });
    await result.catch((error: AggregateError) => {
      expect(error.errors).toHaveLength(3);
      expect(error.errors[0]).toBe(captureFailure);
      expect(error.errors[1]).toBe(cleanupFailure);
      expect(error.errors[2]).toBe(coreFailure);
    });
  });

  it.each(['capture', 'cleanup', 'core'] as const)('retains synchronous %s throws through the async API', async phase => {
    const failure = new Error(`${phase} threw synchronously`);
    const events: string[] = [];
    const captures = createDeferredCaptureErrors();

    await expect(captures.collect('reader screenshot', () => {
      events.push('capture');
      if (phase === 'capture') throw failure;
    }, () => {
      events.push('cleanup');
      if (phase === 'cleanup') throw failure;
    })).resolves.toBeUndefined();
    await expect(captures.finishWith(() => {
      events.push('core');
      if (phase === 'core') throw failure;
    })).rejects.toBe(failure);

    expect(events).toEqual(['capture', 'cleanup', 'core']);
  });

  it('retains falsy non-Error throws rather than treating them as success', async () => {
    const captures = createDeferredCaptureErrors();

    await captures.collect('reader screenshot', () => {
      throw undefined;
    }, () => undefined);
    await expect(captures.finishWith(() => undefined)).rejects.toBeUndefined();
  });

  it('does not let callers mutate the API or aggregate error array to clear retained failures', async () => {
    const captureFailure = new Error('capture failed');
    const cleanupFailure = new Error('cleanup failed');
    const captures = createDeferredCaptureErrors();

    await captures.collect('reader screenshot', () => {
      throw captureFailure;
    }, () => {
      throw cleanupFailure;
    });
    const first = captures.finishWith(() => undefined);
    await expect(first).rejects.toBeInstanceOf(AggregateError);
    await first.catch((error: AggregateError) => {
      error.errors.length = 0;
    });

    expect(Object.isFrozen(captures)).toBe(true);
    expect(Object.keys(captures).sort()).toEqual(['collect', 'finishWith']);
    expect(Reflect.set(captures, 'finishWith', () => Promise.resolve())).toBe(false);

    const core = jest.fn(() => undefined);
    const second = captures.finishWith(core);
    await expect(second).rejects.toBeInstanceOf(AggregateError);
    await second.catch((error: AggregateError) => {
      expect(error.errors).toHaveLength(2);
      expect(error.errors[0]).toBe(captureFailure);
      expect(error.errors[1]).toBe(cleanupFailure);
    });
    expect(core).toHaveBeenCalledTimes(1);
  });
});
