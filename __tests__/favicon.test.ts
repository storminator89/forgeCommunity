import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const source = readFileSync(path.join(root, 'app/icon.svg'), 'utf8');

function parseIcon(): SVGSVGElement {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  expect(document.querySelector('parsererror')).toBeNull();
  return document.documentElement as unknown as SVGSVGElement;
}

describe('ForgeCommunity file-based favicon', () => {
  it('is a small, intrinsically sized vector with a square scalable viewport', () => {
    const icon = parseIcon();
    expect(icon.localName).toBe('svg');
    expect(icon.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(icon.getAttribute('width')).toBe('32');
    expect(icon.getAttribute('height')).toBe('32');
    expect(icon.getAttribute('viewBox')).toBe('0 0 32 32');
    expect(Buffer.byteLength(source)).toBeLessThan(1024);
  });

  it('names the original open-book and forge-spark mark without rendering tiny lettering', () => {
    const icon = parseIcon();
    expect(icon.getAttribute('role')).toBe('img');
    expect(icon.getAttribute('aria-labelledby')).toBe('title description');
    expect(icon.querySelector('#title')?.textContent).toBe('ForgeCommunity');
    expect(icon.querySelector('#description')?.textContent).toBe('Ein offenes Buch mit aufsteigendem Funken.');
    expect(icon.querySelectorAll('path')).toHaveLength(3);
    expect(icon.querySelector('text')).toBeNull();
  });

  it('uses only self-contained static SVG geometry and inert descriptive metadata', () => {
    const allowedAttributes: Record<string, string[]> = {
      svg: ['xmlns', 'width', 'height', 'viewBox', 'role', 'aria-labelledby'],
      title: ['id'],
      desc: ['id'],
      rect: ['x', 'y', 'width', 'height', 'rx', 'fill', 'stroke'],
      path: ['d', 'fill'],
    };
    const icon = parseIcon();
    expect(source).not.toMatch(/<!DOCTYPE|<!ENTITY|<\?/i);
    expect([icon, ...icon.querySelectorAll('*')].map(element => element.localName)).toEqual([
      'svg', 'title', 'desc', 'rect', 'path', 'path', 'path',
    ]);
    for (const element of [icon, ...icon.querySelectorAll('*')]) {
      expect(element.namespaceURI).toBe('http://www.w3.org/2000/svg');
      for (const attribute of element.attributes) {
        expect(allowedAttributes[element.localName]).toContain(attribute.name);
        if (attribute.name !== 'xmlns') expect(attribute.value).not.toMatch(/url\(|javascript:|data:|https?:/i);
      }
    }
  });

  it('keeps the split pages and single spark on an opaque petrol field in both themes', () => {
    const icon = parseIcon();
    const field = icon.querySelector('rect');
    expect(field?.getAttribute('fill')).toBe('#075C65');
    expect(field?.getAttribute('stroke')).toBe('#EFF8F6');
    expect(field?.getAttribute('width')).toBe('31');
    expect(field?.getAttribute('height')).toBe('31');
    expect([...icon.querySelectorAll('path')].map(element => element.getAttribute('fill'))).toEqual([
      '#EFF8F6', '#EF8D75', '#F2C75C',
    ]);
    expect([...icon.querySelectorAll('path')].map(element => element.getAttribute('d'))).toEqual([
      'M7 12 15 16V26L7 22Z', 'M17 16 25 10V22L17 26Z', 'm16 4 4 5-4 5-4-5Z',
    ]);
  });

  it('lets the root app/icon.svg convention own the icon without a competing manual link', () => {
    // Next's installed app-icons guide documents automatic rel=icon,
    // type=image/svg+xml and sizes=any. Served behavior is checked in
    // e2e/favicon.pw.ts; these source assertions do not replace that journey.
    const appFiles = readdirSync(path.join(root, 'app'));
    expect(appFiles.filter(file => /^(?:favicon|icon\d*)\./.test(file))).toEqual(['icon.svg']);
    expect(existsSync(path.join(root, 'public/favicon.ico'))).toBe(false);
    const layout = readFileSync(path.join(root, 'app/layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/\bicons\s*:|<link\b[^>]*\brel\s*=\s*['"](?:shortcut )?icon['"]/i);
    expect(layout).toContain("title: 'ForgeCommunity'");
    expect(layout).toContain("description: 'Eine Plattform für Wachstum, Austausch und Zusammenarbeit'");
  });
});
