import { act, fireEvent, render } from '@testing-library/react';
import { JourneyMascot } from '@/app/courses/journey/JourneyMascot';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => {
    // The real Next image source/unoptimized behavior is also checked in a browser.
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt="" />;
  },
}));

const clipSelector = 'img[src^="/images/forge-spark-celebrate-once.webp?play="]';
const staticSelector = 'img[src="/images/forge-spark-celebrate-final.webp"]';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it.each([
  { complete: false, celebrationId: null, ambientMotion: true },
  { complete: true, celebrationId: null, ambientMotion: true },
  { complete: true, celebrationId: 1, ambientMotion: false },
])('never mounts the clip without an eligible completion: %j', props => {
  const view = render(<JourneyMascot {...props} />);
  expect(view.container.querySelector(clipSelector)).toBeNull();
  expect(view.container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
});

it('keeps its static fallback and starts the full playback window only after load', () => {
  const view = render(<JourneyMascot complete celebrationId={1} ambientMotion />);
  const clip = view.container.querySelector(clipSelector)!;
  expect(view.container.querySelector(staticSelector)).toBeInTheDocument();
  expect(clip).toHaveAttribute('data-spark-celebration', 'loading');
  expect(clip).toHaveClass('invisible');
  act(() => jest.advanceTimersByTime(6000));
  expect(clip).toBeInTheDocument();
  fireEvent.load(clip);
  expect(clip).toHaveAttribute('data-spark-celebration', 'playing');
  expect(clip).not.toHaveClass('invisible');
  expect(view.container.querySelector('[data-spark-static]')).toHaveClass('invisible');
  act(() => jest.advanceTimersByTime(1999));
  expect(clip).toBeInTheDocument();
  // Duplicate load events cannot restart or extend the clip.
  fireEvent.load(clip);
  act(() => jest.advanceTimersByTime(1));
  expect(view.container.querySelector(clipSelector)).toBeNull();
  expect(view.container.querySelector(staticSelector)).toBeInTheDocument();
  expect(view.container.querySelector('[data-spark-static]')).not.toHaveClass('invisible');
  view.rerender(<JourneyMascot complete celebrationId={1} ambientMotion />);
  expect(view.container.querySelector(clipSelector)).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});

it('settles immediately on failure and cannot be revived by a late load callback', () => {
  const view = render(<JourneyMascot complete celebrationId={1} ambientMotion />);
  const clip = view.container.querySelector(clipSelector)!;
  fireEvent.error(clip);
  fireEvent.load(clip);
  expect(view.container.querySelector(clipSelector)).toBeNull();
  expect(view.container.querySelector(staticSelector)).toBeInTheDocument();
  expect(view.container.querySelector('[data-spark-static]')).not.toHaveClass('invisible');
  expect(jest.getTimerCount()).toBe(0);
});

it('abandons a lost load after eight seconds without replaying on a late response', () => {
  const view = render(<JourneyMascot complete celebrationId={1} ambientMotion />);
  const clip = view.container.querySelector(clipSelector)!;
  act(() => jest.advanceTimersByTime(8000));
  fireEvent.load(clip);
  expect(view.container.querySelector(clipSelector)).toBeNull();
  expect(view.container.querySelector(staticSelector)).toBeInTheDocument();
  expect(view.container.querySelector('[data-spark-static]')).not.toHaveClass('invisible');
  expect(jest.getTimerCount()).toBe(0);
});

it.each(['loading', 'playing'])('clears all %s timers on unmount', phase => {
  const view = render(<JourneyMascot complete celebrationId={1} ambientMotion />);
  if (phase === 'playing') fireEvent.load(view.container.querySelector(clipSelector)!);
  expect(jest.getTimerCount()).toBe(1);
  view.unmount();
  expect(jest.getTimerCount()).toBe(0);
});
