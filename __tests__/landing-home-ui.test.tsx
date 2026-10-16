import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
import Home from '@/app/page';
import { renderToString } from 'react-dom/server.node';
import { ForgeWorkbench } from '@/components/landing/ForgeWorkbench';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => <button aria-label="Farbschema auswählen" /> }));

const destinations = [
  ['Community', '/community'], ['Kurse', '/courses'], ['Wissensdatenbank', '/knowledgebase'],
  ['Projekte', '/showcases'], ['Mitglieder', '/members'], ['Events', '/events'],
];
let reduced = false;
let listeners: Set<() => void>;
function session(authenticated: boolean) {
  if (authenticated) {
    jest.mocked(useSession).mockReturnValue({
      data: { user: { id: 'landing-member', name: 'Landing member' }, expires: '2099-01-01' },
      status: 'authenticated', update: jest.fn(),
    });
  } else {
    jest.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated', update: jest.fn() });
  }
}
function changeReduced(value: boolean) {
  act(() => { reduced = value; listeners.forEach(listener => listener()); });
}

beforeEach(() => {
  jest.clearAllMocks();
  reduced = false;
  listeners = new Set();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => ({
    get matches() { return reduced; },
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  })) });
  session(false);
});

it('keeps the public entry and six guest destinations with their encoded login callbacks', () => {
  render(<Home />);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Lernen.Machen.Weitergeben.');
  expect(screen.getByRole('link', { name: 'Konto erstellen' })).toHaveAttribute('href', '/register');
  expect(screen.getByRole('link', { name: 'Anmelden' })).toHaveAttribute('href', '/login');
  const areas = within(screen.getByRole('navigation', { name: 'Bereiche' }));
  expect(areas.getAllByRole('link')).toHaveLength(6);
  for (const [name, href] of destinations) {
    expect(areas.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute('href', `/login?callbackUrl=${encodeURIComponent(href)}`);
  }
  for (const link of screen.getAllByRole('link', { name: 'Über uns' })) expect(link).toHaveAttribute('href', '/about');
  expect(screen.getByRole('link', { name: 'ForgeCommunity Startseite' })).toHaveAttribute('href', '/');
  expect(screen.getByRole('link', { name: 'Bereiche ansehen' })).toHaveAttribute('href', '#bereiche');
  expect(screen.getByRole('main')).toHaveAttribute('id', 'page-content');
  expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
  expect(screen.getByRole('link', { name: 'Zum Inhalt springen' })).toHaveAttribute('href', '#page-content');
});

it('retains the deliberate signed-in community CTA and direct area destinations', () => {
  session(true);
  const view = render(<Home />);
  expect(screen.getByRole('link', { name: 'Zur Community' })).toHaveAttribute('href', '/community');
  const header = within(screen.getByRole('banner'));
  expect(header.getByRole('link', { name: 'Community' })).toHaveAttribute('href', '/community');
  const areas = within(screen.getByRole('navigation', { name: 'Bereiche' }));
  for (const [name, href] of destinations) expect(areas.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute('href', href);
  // A session ending in place must restore guest destinations as well.
  session(false);
  view.rerender(<Home />);
  expect(screen.getByRole('link', { name: 'Konto erstellen' })).toHaveAttribute('href', '/register');
  expect(areas.getByRole('link', { name: /^Projekte/ })).toHaveAttribute('href', '/login?callbackUrl=%2Fshowcases');
});

it('provides one optimized local illustration that stays still until keyboard activation', async () => {
  const user = userEvent.setup();
  const { container } = render(<Home />);
  const illustration = screen.getByRole('img', { name: /Illustration: Zwei Erwachsene.*Ideenfunken.*Buch.*Bausteinen/ });
  expect(illustration.tagName.toLowerCase()).toBe('img');
  expect(illustration).toHaveAttribute('src', '/images/home/forge-workbench-768.webp');
  const picture = illustration.closest('picture')!;
  expect(picture).not.toBeNull();
  expect(picture.querySelectorAll('source')).toHaveLength(0);
  expect(illustration).toHaveAttribute('srcset', '/images/home/forge-workbench-480.webp 480w, /images/home/forge-workbench-768.webp 768w, /images/home/forge-workbench-1440.webp 1440w');
  expect(illustration).toHaveAttribute('sizes', '(max-width: 30rem) calc(100vw - 3.125rem), (max-width: 34.5rem) calc(100vw - 3.625rem), (max-width: 46rem) 30.875rem, (max-width: 82.5rem) calc(55vw - 3.05rem), 42.325rem');
  expect(illustration).toHaveAttribute('width', '1440');
  expect(illustration).toHaveAttribute('height', '960');
  expect(illustration).toHaveAttribute('loading', 'eager');
  expect(illustration).toHaveAttribute('fetchpriority', 'high');
  expect(illustration).toHaveAttribute('decoding', 'async');
  const frame = () => container.querySelector<HTMLElement>('[data-motion="forge-workbench"]')!;
  expect(within(frame()).getAllByRole('img')).toHaveLength(1);
  expect(frame()).not.toHaveClass('illustrationPlaying');
  const replay = screen.getByRole('button', { name: 'Illustration bewegen' });
  replay.focus();
  await user.keyboard('{Enter}');
  expect(replay).toHaveFocus();
  expect(frame()).toHaveClass('illustrationPlaying');
  fireEvent.animationEnd(frame());
  expect(frame()).not.toHaveClass('illustrationPlaying');
  await user.keyboard(' ');
  expect(frame()).toHaveClass('illustrationPlaying');
});

it('uses native disabled semantics for reduced motion and cancels live animation without auto-resuming', () => {
  reduced = true;
  const { container, unmount } = render(<Home />);
  const frame = () => container.querySelector('[data-motion="forge-workbench"]')!;
  const replay = screen.getByRole('button', { name: 'Illustration bewegen (reduzierte Bewegung aktiv)' });
  expect(replay).toBeDisabled();
  fireEvent.click(replay);
  expect(frame()).not.toHaveClass('illustrationPlaying');
  changeReduced(false);
  expect(replay).toBeEnabled();
  fireEvent.click(replay);
  expect(frame()).toHaveClass('illustrationPlaying');
  changeReduced(true);
  expect(replay).toBeDisabled();
  expect(frame()).not.toHaveClass('illustrationPlaying');
  changeReduced(false);
  expect(replay).toBeEnabled();
  expect(frame()).not.toHaveClass('illustrationPlaying');
  unmount();
  expect(listeners.size).toBe(0);
});


it('hydrates the server image in place without rewriting responsive attributes during preference updates', () => {
  const container = document.createElement('div');
  container.innerHTML = renderToString(<ForgeWorkbench />);
  const serverImage = container.querySelector('img')!;
  const serverPicture = serverImage.closest('picture')!;
  const serverFrame = container.querySelector('[data-motion="forge-workbench"]')!;
  const attributes = () => Array.from(serverImage.attributes, ({ name, value }) => [name, value]);
  const serverAttributes = attributes();
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver(records => mutations.push(...records));
  observer.observe(container, { attributes: true, childList: true, subtree: true });
  const onRecoverableError = jest.fn();
  const view = render(<ForgeWorkbench />, { container, hydrate: true, onRecoverableError });
  try {
    expect(within(container).getByRole('button', { name: 'Illustration bewegen' })).toBeEnabled();
    changeReduced(true);
    expect(within(container).getByRole('button', { name: 'Illustration bewegen (reduzierte Bewegung aktiv)' })).toBeDisabled();
    changeReduced(false);
    view.rerender(<ForgeWorkbench />);
    mutations.push(...observer.takeRecords());
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toBe(serverImage);
    expect(container.querySelector('picture')).toBe(serverPicture);
    expect(container.querySelector('[data-motion="forge-workbench"]')).toBe(serverFrame);
    expect(attributes()).toEqual(serverAttributes);
    expect(serverPicture.querySelectorAll('source')).toHaveLength(0);
    expect(container.querySelectorAll('link[rel="preload"][as="image"]')).toHaveLength(0);
    expect(mutations.filter(record => record.target === serverImage || record.target === serverPicture)).toEqual([]);
    // JSDOM establishes DOM ownership, not image requests, decoding or paint.
  } finally {
    observer.disconnect();
    view.unmount();
  }
});
