import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { SparkEntry } from '@/components/spark-entry';
import { setSparkVisible } from '@/hooks/useSparkVisibility';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt="" />;
  },
}));

const image = (container: HTMLElement) => container.querySelector('img');

beforeEach(() => {
  window.localStorage.clear();
  setSparkVisible(true);
  window.localStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  act(() => setSparkVisible(true));
  window.localStorage.clear();
});

it('shows the existing static Blender Spark on a fresh client without a completion clip', () => {
  const view = render(<SparkEntry />);
  expect(image(view.container)).toHaveAttribute('src', '/images/forge-spark-preview.webp');
  expect(image(view.container)).toHaveAttribute('width', '64');
  expect(image(view.container)).toHaveAttribute('height', '64');
  expect(image(view.container)).toHaveAttribute('alt', '');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  const hide = screen.getByRole('button', { name: 'Spark ausblenden' });
  expect(hide).toBeVisible();
  expect(hide).toHaveClass('h-auto', 'min-w-0', 'whitespace-normal', '[overflow-wrap:anywhere]');
  expect(view.container.querySelector('[data-spark-celebration]')).toBeNull();
});

it('never includes a default image in server HTML before checking a saved opt-out', () => {
  window.localStorage.setItem('forge-journey-mascot-hidden', 'true');
  const html = renderToString(<SparkEntry />);
  expect(html).not.toContain('<img');
  expect(html).toContain('Spark anzeigen');
  const view = render(<SparkEntry />);
  expect(image(view.container)).toBeNull();
});

it('keeps Off across unmount/navigation and reads the original key without changing motion', async () => {
  const user = userEvent.setup();
  window.localStorage.setItem('forge-journey-motion-off', 'true');
  const first = render(<SparkEntry />);
  const hide = screen.getByRole('button', { name: 'Spark ausblenden' });
  hide.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: 'Spark anzeigen' })).toHaveFocus();
  expect(image(first.container)).toBeNull();
  expect(window.localStorage.getItem('forge-journey-mascot-hidden')).toBe('true');
  expect(window.localStorage.getItem('forge-journey-motion-off')).toBe('true');
  first.unmount();
  const next = render(<SparkEntry />);
  expect(image(next.container)).toBeNull();
  const show = screen.getByRole('button', { name: 'Spark anzeigen' });
  show.focus();
  await user.keyboard(' ');
  expect(screen.getByRole('button', { name: 'Spark ausblenden' })).toHaveFocus();
  expect(image(next.container)).toBeInTheDocument();
});

it('synchronizes mounted entry points and cross-tab Off/clear events', () => {
  const view = render(<><SparkEntry /><SparkEntry /></>);
  fireEvent.click(screen.getAllByRole('button', { name: 'Spark ausblenden' })[0]);
  expect(view.container.querySelectorAll('img')).toHaveLength(0);
  expect(screen.getAllByRole('button', { name: 'Spark anzeigen' })).toHaveLength(2);
  act(() => {
    window.localStorage.setItem('forge-journey-mascot-hidden', 'false');
    window.dispatchEvent(new StorageEvent('storage', { key: 'forge-journey-mascot-hidden', newValue: 'false' }));
  });
  expect(view.container.querySelectorAll('img')).toHaveLength(2);
  act(() => {
    window.localStorage.setItem('forge-journey-mascot-hidden', 'true');
    window.dispatchEvent(new StorageEvent('storage', { key: 'forge-journey-mascot-hidden', newValue: 'true' }));
  });
  expect(view.container.querySelectorAll('img')).toHaveLength(0);
  act(() => {
    window.localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
  });
  expect(view.container.querySelectorAll('img')).toHaveLength(2);
});

it.each(['write', 'read and write'])('retains the in-document choice when storage denies %s', kind => {
  const first = render(<SparkEntry />);
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  if (kind === 'read and write') jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  fireEvent.click(screen.getByRole('button', { name: 'Spark ausblenden' }));
  expect(image(first.container)).toBeNull();
  first.unmount();
  const next = render(<SparkEntry />);
  expect(image(next.container)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Spark anzeigen' }));
  expect(image(next.container)).toBeInTheDocument();
});

it('keeps the static image with reduced motion and animation preference Off', () => {
  const media = jest.fn(() => ({ matches: true }));
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: media });
  window.localStorage.setItem('forge-journey-motion-off', 'true');
  const view = render(<SparkEntry />);
  expect(image(view.container)).toBeInTheDocument();
  expect(media).not.toHaveBeenCalled();
  expect(view.container.innerHTML).not.toContain('celebrate');
});

it('removes a failed decorative image without losing the native hide/show control', () => {
  const view = render(<SparkEntry />);
  fireEvent.error(image(view.container)!);
  expect(image(view.container)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Spark ausblenden' }));
  fireEvent.click(screen.getByRole('button', { name: 'Spark anzeigen' }));
  expect(image(view.container)).toHaveAttribute('src', '/images/forge-spark-preview.webp');
});
