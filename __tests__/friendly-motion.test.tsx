import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { FriendlyMotionToggle, useFriendlyMotion } from '@/components/community/FriendlyMotion';

let reduced = false;
let mediaListeners: Set<() => void>;
beforeEach(() => {
  localStorage.clear(); reduced = false; mediaListeners = new Set();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => ({
    get matches() { return reduced; },
    addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
  })) });
});

test('server output starts with motion disabled and a stable accessible control', () => {
  const markup = renderToString(<FriendlyMotionToggle />);
  expect(markup).toContain('aria-pressed="false"');
  expect(markup).toContain('Animationen einschalten');
});

test('device-local opt-out synchronizes all mounted consumers and survives remounting', () => {
  const first = renderHook(useFriendlyMotion);
  const second = renderHook(useFriendlyMotion);
  expect(first.result.current.enabled).toBe(true);
  act(() => first.result.current.toggle());
  expect(first.result.current.enabled).toBe(false);
  expect(second.result.current.enabled).toBe(false);
  expect(localStorage.getItem('forge-community-motion-off')).toBe('true');
  first.unmount();
  const remounted = renderHook(useFriendlyMotion);
  expect(remounted.result.current.enabled).toBe(false);
  act(() => second.result.current.toggle());
  expect(remounted.result.current.enabled).toBe(true);
});

test('system reduced motion always wins, including changes after mount', () => {
  render(<FriendlyMotionToggle />);
  const button = screen.getByRole('button', { name: 'Animationen ausschalten' });
  act(() => { reduced = true; mediaListeners.forEach(listener => listener()); });
  expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(localStorage.getItem('forge-community-motion-off')).toBeNull();
  act(() => { reduced = false; mediaListeners.forEach(listener => listener()); });
  expect(button).toHaveAttribute('aria-pressed', 'true');
});

test('syncs storage changes from another tab and removes subscriptions on unmount', () => {
  const hook = renderHook(useFriendlyMotion);
  act(() => { localStorage.setItem('forge-community-motion-off', 'true'); window.dispatchEvent(new StorageEvent('storage')); });
  expect(hook.result.current.enabled).toBe(false);
  hook.unmount();
  expect(mediaListeners.size).toBe(0);
});


test('an explicit off choice survives media changes when storage is blocked', () => {
  const hook = renderHook(useFriendlyMotion);
  const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  try {
    act(() => hook.result.current.toggle());
    expect(hook.result.current.enabled).toBe(false);
    act(() => { reduced = true; mediaListeners.forEach(listener => listener()); });
    act(() => { reduced = false; mediaListeners.forEach(listener => listener()); window.dispatchEvent(new StorageEvent('storage')); });
    expect(hook.result.current.enabled).toBe(false);
    const other = renderHook(useFriendlyMotion);
    expect(other.result.current.enabled).toBe(false);
    other.unmount(); hook.unmount();
  } finally { get.mockRestore(); set.mockRestore(); }
});
