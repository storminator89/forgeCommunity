import React from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parse, type Rule } from 'postcss';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppHeader, AppShell } from '@/components/app-shell';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { SpaceShell } from '@/components/spaces/SpaceShell';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserNav } from '@/components/user-nav';
import { signOut, useSession } from 'next-auth/react';

const mockPush = jest.fn();
const mockSetTheme = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('next-auth/react', () => ({ useSession: jest.fn(), signOut: jest.fn() }));
jest.mock('next-themes', () => ({ useTheme: () => ({ setTheme: mockSetTheme }) }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'header-member', name: 'Header QA Member', role: 'USER' } }, status: 'authenticated', update: jest.fn() } as any);
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : entry.name.endsWith('.tsx') ? [file] : [];
  });
}

function classNames(node: ts.JsxElement | ts.JsxSelfClosingElement): string[] {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const attribute = opening.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText() === 'className');
  if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isStringLiteral(attribute.initializer)) return [];
  return attribute.initializer.text.split(/\s+/);
}

it('contains absolute main content without changing native scrolling or focus behavior', () => {
  // JSDOM has no scroll layout. The browser gate checks the real existing
  // sr-only descendants, root range and native skip-link/keyboard sequence.
  const stylesheet = parse(readFileSync(path.resolve(__dirname, '../app/globals.css'), 'utf8'));
  const matches: Rule[] = [];
  stylesheet.walkRules(rule => { if (rule.selector === '.app-shell #page-content') matches.push(rule); });
  expect(matches).toHaveLength(1);
  expect(matches[0].nodes.map(node => node.type === 'decl' ? [node.prop, node.value, Boolean(node.important)] : node.type)).toEqual([['position', 'relative', false]]);
  expect(matches[0].parent).toMatchObject({ type: 'atrule', name: 'layer', params: 'components' });
});

it('gives every real AppHeader an explicit semantic title/row/actions contract, including fallbacks', () => {
  // JSDOM cannot prove reflow. This source contract catches omitted variants;
  // the separate real-browser bounds gate establishes the resulting geometry.
  const root = path.resolve(__dirname, '..');
  const headers: Array<{ file: string; node: ts.JsxElement }> = [];
  for (const file of [...sourceFiles(path.join(root, 'app')), ...sourceFiles(path.join(root, 'components'))]) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'AppHeader') headers.push({ file: path.relative(root, file), node });
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(headers.length).toBeGreaterThan(40);
  for (const { file, node } of headers) {
    const elements: Array<ts.JsxElement | ts.JsxSelfClosingElement> = [];
    const visit = (child: ts.Node) => {
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) elements.push(child);
      ts.forEachChild(child, visit);
    };
    node.children.forEach(visit);
    const slots = (name: string) => elements.filter(element => classNames(element).includes(name));
    expect({ file, rows: slots('app-header-row').length }).toEqual({ file, rows: 1 });
    const titles = slots('app-header-title');
    expect({ file, titles: titles.length }).toEqual({ file, titles: 1 });
    const title = ts.isJsxElement(titles[0]) ? titles[0].openingElement : titles[0];
    if (title.tagName.getText() === 'div') {
      // Some real titles include a context line, icon or return destination.
      // The named geometry wrapper must retain its semantic content inside.
      const semanticChildren = elements.filter(element => {
        const opening = ts.isJsxElement(element) ? element.openingElement : element;
        return ['h1', 'h2', 'Link', 'a', 'span'].includes(opening.tagName.getText()) && titles[0].pos <= element.pos && element.end <= titles[0].end;
      });
      expect({ file, hasSemanticTitle: semanticChildren.length > 0 }).toEqual({ file, hasSemanticTitle: true });
    } else expect(['h1', 'h2', 'Link', 'a', 'span']).toContain(title.tagName.getText());
    const authControls = elements.filter(element => {
      const opening = ts.isJsxElement(element) ? element.openingElement : element;
      return ['ThemeToggle', 'UserNav'].includes(opening.tagName.getText());
    });
    expect({ file, actions: slots('app-header-actions').length }).toEqual({ file, actions: authControls.length ? 1 : 0 });
    if (!file.includes('/contents/')) expect(classNames(titles[0])).not.toContain('truncate');
  }
});

it('keeps a simple loading title, native menu and actual skip-link destination', () => {
  render(<AppShell><AppHeader aria-label="Community-Kopfzeile"><div className="app-header-row"><h1 className="app-header-title">Community</h1></div></AppHeader><main id="page-content" tabIndex={-1} /></AppShell>);
  const header = screen.getByRole('banner', { name: 'Community-Kopfzeile' });
  const layout = header.querySelector('.app-header-layout');
  expect(layout).not.toBeNull();
  const menu = within(header).getByRole('button', { name: 'Navigation öffnen' });
  expect(menu.parentElement).toBe(layout);
  expect(menu).toHaveAttribute('type', 'button');
  expect(menu).toHaveAttribute('aria-expanded', 'false');
  expect(menu).not.toHaveAttribute('aria-controls');
  expect(within(header).getByRole('heading', { level: 1, name: 'Community' })).toHaveClass('app-header-title');
  expect(within(header).queryByRole('button', { name: 'Benutzermenü öffnen' })).not.toBeInTheDocument();
  const skip = screen.getByRole('link', { name: 'Zum Inhalt springen' });
  expect(skip).toHaveAttribute('href', '#page-content');
  expect(screen.getByRole('main')).toHaveAttribute('id', 'page-content');
  expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
});

it('preserves the nested Admin h2 and complete title rather than clipping it', () => {
  const title = 'Administration und Benutzerverwaltung';
  render(<AppShell><AdminHeader title={title} onMenuClick={() => {}} /></AppShell>);
  const heading = screen.getByRole('heading', { level: 2, name: title });
  expect(heading).toHaveClass('app-header-title');
  expect(heading).not.toHaveClass('truncate');
  const header = screen.getByRole('banner');
  expect(header.querySelector('.app-header-actions')).toContainElement(screen.getByRole('button', { name: 'Farbschema auswählen' }));
  expect(header.querySelector('.app-header-actions')).toContainElement(screen.getByRole('button', { name: 'Benutzermenü öffnen' }));
});

it('preserves the Space title as a real, fully named destination link', () => {
  render(<SpaceShell><h1>Route QA public space</h1></SpaceShell>);
  const title = within(screen.getByRole('banner')).getByRole('link', { name: 'Spaces' });
  expect(title).toHaveClass('app-header-title');
  expect(title).not.toHaveClass('truncate');
  expect(title).toHaveAttribute('href', '/community/spaces');
  expect(screen.getByRole('heading', { level: 1, name: 'Route QA public space' })).toBeInTheDocument();
});

it('keeps the named theme control keyboard-operable inside the shared actions', async () => {
  const user = userEvent.setup();
  render(<AppShell><AppHeader><div className="app-header-row"><h1 className="app-header-title">Community</h1><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div></AppHeader></AppShell>);
  const theme = screen.getByRole('button', { name: 'Farbschema auswählen' });
  theme.focus();
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('menuitem', { name: 'Dunkel' }));
  expect(mockSetTheme).toHaveBeenCalledWith('dark');
});

it.each(['USER', 'ADMIN'])('retains %s account actions and explicit sign-out behavior', async role => {
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'header-member', name: 'Header QA Member', role } }, status: 'authenticated', update: jest.fn() } as any);
  const user = userEvent.setup();
  render(<AppShell><AppHeader><div className="app-header-row"><h1 className="app-header-title">Community</h1><div className="app-header-actions"><ThemeToggle /><UserNav /></div></div></AppHeader></AppShell>);
  screen.getByRole('button', { name: 'Benutzermenü öffnen' }).focus();
  await user.keyboard('{Enter}');
  for (const name of ['Profil', 'Einstellungen', 'Meine Kurse', 'Nachrichten', 'Abmelden']) expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Admin Dashboard' }) !== null).toBe(role === 'ADMIN');
  expect(signOut).not.toHaveBeenCalled();
  await user.click(screen.getByRole('menuitem', { name: 'Abmelden' }));
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login', redirect: true });
});
