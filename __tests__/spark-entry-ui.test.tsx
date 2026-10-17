import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { SparkVisibilitySetting } from '@/components/spark-visibility-setting';
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

it('shows the existing static Blender Spark on a fresh client without a completion clip or inline control', () => {
  const view = render(<SparkEntry />);
  expect(image(view.container)).toHaveAttribute('src', '/images/forge-spark-preview.webp');
  expect(image(view.container)).toHaveAttribute('width', '64');
  expect(image(view.container)).toHaveAttribute('height', '64');
  expect(image(view.container)).toHaveAttribute('alt', '');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(view.container).not.toHaveTextContent(/Spark (ausblenden|anzeigen)/);
  expect(view.container.querySelector('[data-spark-celebration]')).toBeNull();
});

it('never includes a default image in server HTML before checking a saved opt-out', () => {
  window.localStorage.setItem('forge-journey-mascot-hidden', 'true');
  const html = renderToString(<SparkEntry />);
  expect(html).not.toContain('<img');
  expect(html).toBe('');
  const view = render(<><SparkEntry /><SparkVisibilitySetting /></>);
  expect(image(view.container)).toBeNull();
});

it('keeps Off across unmount/navigation and reads the original key without changing motion', async () => {
  const user = userEvent.setup();
  window.localStorage.setItem('forge-journey-motion-off', 'true');
  const first = render(<><SparkEntry /><SparkVisibilitySetting /></>);
  const hide = screen.getByRole('switch', { name: 'Spark anzeigen' });
  hide.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('switch', { name: 'Spark anzeigen' })).toHaveFocus();
  expect(image(first.container)).toBeNull();
  expect(window.localStorage.getItem('forge-journey-mascot-hidden')).toBe('true');
  expect(window.localStorage.getItem('forge-journey-motion-off')).toBe('true');
  first.unmount();
  const next = render(<><SparkEntry /><SparkVisibilitySetting /></>);
  expect(image(next.container)).toBeNull();
  const show = screen.getByRole('switch', { name: 'Spark anzeigen' });
  show.focus();
  await user.keyboard(' ');
  expect(screen.getByRole('switch', { name: 'Spark anzeigen' })).toHaveFocus();
  expect(image(next.container)).toBeInTheDocument();
});

it('synchronizes mounted entry points and cross-tab Off/clear events', () => {
  const view = render(<><SparkEntry /><SparkEntry /><SparkVisibilitySetting /></>);
  fireEvent.click(screen.getByRole('switch', { name: 'Spark anzeigen' }));
  expect(view.container.querySelectorAll('img')).toHaveLength(0);
  expect(screen.getByRole('switch', { name: 'Spark anzeigen' })).not.toBeChecked();
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
  const first = render(<><SparkEntry /><SparkVisibilitySetting /></>);
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  if (kind === 'read and write') jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  fireEvent.click(screen.getByRole('switch', { name: 'Spark anzeigen' }));
  expect(image(first.container)).toBeNull();
  first.unmount();
  const next = render(<><SparkEntry /><SparkVisibilitySetting /></>);
  expect(image(next.container)).toBeNull();
  fireEvent.click(screen.getByRole('switch', { name: 'Spark anzeigen' }));
  expect(image(next.container)).toBeInTheDocument();
});

it('keeps the static image with reduced motion and animation preference Off', () => {
  const media = jest.fn(() => ({ matches: true }));
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: media });
  window.localStorage.setItem('forge-journey-motion-off', 'true');
  const view = render(<><SparkEntry /><SparkVisibilitySetting /></>);
  expect(image(view.container)).toBeInTheDocument();
  expect(media).not.toHaveBeenCalled();
  expect(view.container.innerHTML).not.toContain('celebrate');
});

it('removes a failed decorative image and restores it through the settings switch', () => {
  const view = render(<><SparkEntry /><SparkVisibilitySetting /></>);
  fireEvent.error(image(view.container)!);
  expect(image(view.container)).toBeNull();
  fireEvent.click(screen.getByRole('switch', { name: 'Spark anzeigen' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Spark anzeigen' }));
  expect(image(view.container)).toHaveAttribute('src', '/images/forge-spark-preview.webp');
});
