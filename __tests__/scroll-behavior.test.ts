/** @jest-environment node */
import { getPreferredScrollBehavior } from '@/lib/scroll-behavior';

afterEach(() => { Reflect.deleteProperty(globalThis, 'window'); });

it('is safe to import and call without a browser', () => {
  expect(getPreferredScrollBehavior()).toBe('instant');
});

it('avoids animation when matchMedia is unavailable', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  expect(getPreferredScrollBehavior()).toBe('instant');
});

it.each([true, false])('chooses the scroll behavior for reduced motion = %s', reducedMotion => {
  const matchMedia = jest.fn(() => ({ matches: reducedMotion }));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia } });
  expect(getPreferredScrollBehavior()).toBe(reducedMotion ? 'instant' : 'smooth');
  expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
});
