import { StrictMode } from 'react';
import { act, render } from '@testing-library/react';
import { JourneyMascot } from '@/app/courses/journey/JourneyMascot';

// Deliberately use the real Next Image component. Async act normally flushes
// passive effects before a resolved decode promise, so also force its cached
// ref/onLoad path to run before passive setup. This deterministically exercises
// the ordering that previously cleared playback during StrictMode replay.
const decodeCases = [
  ['after passive setup', () => Promise.resolve()],
  ['before passive setup', () => ({
    catch: () => ({ then: (decoded: () => void) => decoded() }),
  }) as unknown as Promise<void>],
] as const;

it.each(decodeCases)('keeps the two-second deadline when cached Next Image loads %s with StrictMode replay', async (_ordering, decodeImage) => {
  jest.useFakeTimers();
  const complete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
  const decode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
  Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true });
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: decodeImage });
  let view: ReturnType<typeof render> | undefined;
  try {
    await act(async () => {
      view = render(<StrictMode><JourneyMascot complete celebrationId={1} ambientMotion /></StrictMode>);
    });
    const clip = view!.container.querySelector('[data-spark-celebration]');
    expect(clip).toHaveAttribute('data-spark-celebration', 'playing');
    expect(view!.container.querySelector('[data-spark-static]')).toHaveClass('invisible');
    act(() => jest.advanceTimersByTime(1999));
    expect(clip).toBeInTheDocument();
    act(() => jest.advanceTimersByTime(1));
    expect(view!.container.querySelector('[data-spark-celebration]')).toBeNull();
    expect(view!.container.querySelector('[data-spark-static]')).not.toHaveClass('invisible');
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    view?.unmount();
    if (complete) Object.defineProperty(HTMLImageElement.prototype, 'complete', complete);
    if (decode) Object.defineProperty(HTMLImageElement.prototype, 'decode', decode);
    else Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
    jest.useRealTimers();
  }
});
