/** @jest-environment node */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { Writable } from 'node:stream';
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import { ForgeWorkbench } from '../components/landing/ForgeWorkbench';
import { artworkCandidates, fixedArtworkDelivery } from '../e2e/landing-artwork-contract';

const source = (name: string) => readFileSync(path.join(process.cwd(), name), 'utf8');
const css = source('app/home.module.css');
const illustration = source('components/landing/ForgeWorkbench.tsx');

it('uses frozen semantic chrome, scoped focus and flexible narrow-screen layout around the full illustration', () => {
  expect(css).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(\s*\d/gi);
  expect(css).not.toMatch(/@import|font-family|overflow(?:-x)?:\s*hidden|white-space:\s*nowrap/i);
  for (const token of ['background', 'foreground', 'primary', 'primary-foreground', 'border', 'card']) {
    expect(css).toContain(`var(--${token})`);
  }
  expect(css).toContain('.page a:focus-visible');
  expect(css).toContain('outline: 3px solid hsl(var(--ring))');
  expect(css).toContain('overflow-wrap: anywhere');
  expect(css).toContain('flex-wrap: wrap');
  expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
  expect(css).toContain('@media (forced-colors: active)');
  expect(css).toMatch(/\.illustration\s*\{[^}]*width: 100%;[^}]*height: auto;/);
  expect(css).toMatch(/\.artFrame\s*\{[^}]*var\(--border\)[^}]*var\(--card\)/);
  expect(css).not.toMatch(/object-fit:\s*cover|filter:|mix-blend-mode:/);
});

it('has only one finite, opt-in motion and no external illustration dependency', () => {
  expect(css.match(/animation:/g)).toHaveLength(1);
  expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.illustrationPlaying\s*\{[^}]*animation: forgeWorkbench 850ms ease-out 1/);
  expect(css).not.toMatch(/infinite|transition:|scroll-behavior:/);
  expect(illustration).toContain('useState(0)');
  expect(illustration).toContain('disabled={reducedMotion}');
  expect(illustration).not.toMatch(/<svg\b|<image\b|<foreignObject\b|https?:|<animate\b|<script\b/);
  expect(illustration).toContain('loading="eager"');
  expect(illustration).toContain('fetchPriority="high"');
  expect(illustration).not.toMatch(/preload|\bpriority=|_next\/image|data:image/i);
});

it('adds real CI screenshots alongside the exact accessible landing heading contracts', () => {
  const browser = source('e2e/landing-home.pw.ts');
  expect(browser).toContain("['light', 'dark']");
  expect(browser).toContain("['guest', 'member']");
  expect(browser).toContain("fontSize = '200%'");
  expect(browser).toContain('fullPage: true');
  expect(browser).toContain("reducedMotion: 'reduce'");
  expect(browser).toContain("request.post(`${origin}/api/register`");
  expect(browser).not.toContain("page.route('**/api/auth/session'");
  expect(browser).toContain('(element as HTMLImageElement).decode()');
  expect(browser).toContain('currentSrc');
  expect(browser).toContain('deviceScaleFactor: 2');
  expect(browser).toContain('response.body()');
  expect(browser).toContain('expect(delivery.requests).toEqual([state.currentSrc])');
  expect(browser).toContain('expect(state.heroPreloads).toEqual([])');
  expect(browser).toContain('resource.initiatorType');
  expect(browser).toContain('response.fromServiceWorker()');
  expect(browser).toContain("testInfo.attach('home-artwork-delivery.json'");
  expect(browser).toContain("testInfo.outputPath('home-artwork-delivery.json')");
  expect(browser).toContain('writeFile(evidencePath, JSON.stringify(');
  expect(browser).toContain("path: evidencePath, contentType: 'application/json'");
  const workflow = source('.github/workflows/ci.yml');
  expect(workflow).toContain('test-results/**/*.png');
  expect(workflow).toContain('test-results/**/home-artwork-delivery.json');
  expect(workflow).not.toContain('test-results/**/*.json');
  expect(browser).toContain('state.frameContentWidth - state.slot.width');
  expect(browser).toContain('expect(state.resourceTimings).toHaveLength(1)');
  expect(browser).toContain('expect(bytes.length).toBe(fixedArtworkDelivery.bytes)');
  expect(browser).toContain('expect(state.naturalWidth).toBe(fixedArtworkDelivery.width)');
  expect(browser).toContain('expect(state.naturalHeight).toBe(fixedArtworkDelivery.height)');
  expect(browser).toContain('window.visualViewport.scale');
  expect(browser).not.toMatch(/viewport(?:Size\(\)!)?\.width\s*<=\s*390/);
  // Playwright inserts spaces for BR in accessible names; textContent does not.
  const heading = 'Lernen. Machen. Weitergeben.';
  expect(source('e2e/route-sweep-manifest.ts')).toContain(`heading: '${heading}'`);
  for (const name of ['e2e/browser-qa.pw.ts', 'e2e/cross-engine.smoke.ts']) {
    expect(source(name)).toContain(`name: '${heading}', exact: true`);
  }
});

it('pins the generated original and verifies every uncropped responsive WebP against a small byte budget', async () => {
  const directory = path.join(process.cwd(), 'public/images/home');
  const provenance = JSON.parse(source('public/images/home/forge-workbench.provenance.json')) as {
    generator: string;
    source: { format: string; width: number; height: number; bytes: number; sha256: string };
    assets: { file: string; width: number; height: number; bytes: number; sha256: string }[];
  };
  expect(provenance.generator).toBe('OpenAI Image Tool');
  expect(provenance.source).toEqual({
    format: 'png', width: 1536, height: 1024, bytes: 1805556,
    sha256: 'fce1639bdbbffc80860a84a0141add84b555ddec167d7e4aa772f32e70251ecc',
  });
  expect(provenance.assets.map(({ width, bytes }) => ({ width, bytes }))).toEqual(artworkCandidates);
  const budgets: Record<number, number> = { 480: 20 * 1024, 768: 40 * 1024, 1440: 100 * 1024 };
  let total = 0;
  for (const asset of provenance.assets) {
    const bytes = readFileSync(path.join(directory, asset.file));
    const metadata = await sharp(bytes).metadata();
    expect(asset.file).toBe(`forge-workbench-${asset.width}.webp`);
    expect(metadata.format).toBe('webp');
    expect(metadata.hasAlpha).toBe(false);
    expect(metadata.width).toBe(asset.width);
    expect(metadata.height).toBe(asset.height);
    expect(asset.width / asset.height).toBe(3 / 2);
    expect(bytes.length).toBe(asset.bytes);
    expect(bytes.length).toBeLessThanOrEqual(budgets[asset.width]);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    total += bytes.length;
  }
  expect(total).toBeLessThanOrEqual(150 * 1024);
  expect(readdirSync(directory).filter(file => file.startsWith('forge-workbench-')).sort()).toEqual(
    provenance.assets.map(asset => asset.file).sort(),
  );
});


it('pins the fixed source, one-image byte ceiling and explicit mobile delivery cost', () => {
  expect(fixedArtworkDelivery).toEqual({
    path: '/images/home/forge-workbench-1440.webp', width: 1440, height: 960,
    bytes: 93712, maximumBytes: 100 * 1024,
    mobileExtraBytes: { 480: 76550, 768: 58756 },
  });
  expect(fixedArtworkDelivery.bytes).toBeLessThan(fixedArtworkDelivery.maximumBytes);
  expect(fixedArtworkDelivery.bytes).toBe(artworkCandidates[2].bytes);
  expect(fixedArtworkDelivery.mobileExtraBytes[480]).toBe(fixedArtworkDelivery.bytes - artworkCandidates[0].bytes);
  expect(fixedArtworkDelivery.mobileExtraBytes[768]).toBe(fixedArtworkDelivery.bytes - artworkCandidates[1].bytes);
});

function renderStreamingMarkup(element: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const output = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    output.on('error', reject);
    output.on('finish', () => resolve(Buffer.concat(chunks).toString()));
    const stream = renderToPipeableStream(element, {
      onAllReady() { stream.pipe(output); },
      onError: reject,
    });
  });
}

it.each([
  ['static', (element: ReactElement) => Promise.resolve(renderToStaticMarkup(element))],
  ['streaming', renderStreamingMarkup],
] as const)('keeps one fixed image source and no automatic head hint in %s SSR', async (_name, renderMarkup) => {
  const markup = await renderMarkup(createElement(ForgeWorkbench));
  const standalone = await renderMarkup(createElement('img', {
    src: '/images/home/forge-workbench-1440.webp',
    alt: '', loading: 'eager', fetchPriority: 'high',
  }));
  // The installed renderer hoists a standalone image, including in streaming SSR.
  expect(standalone).toMatch(/<link\b[^>]*rel="preload"[^>]*as="image"/);
  expect(markup).not.toMatch(/<link\b[^>]*rel="preload"/);
  expect(markup).toMatch(/<picture\b[^>]*><img\b/);
  expect(markup).not.toMatch(/<source\b/);
  expect(markup.match(/<img\b/g)).toHaveLength(1);
  const imageMarkup = markup.match(/<img\b[^>]*\/>/)![0];
  expect(imageMarkup).not.toMatch(/\b(?:sizes|srcset)="/i);
  expect(imageMarkup).toContain('src="/images/home/forge-workbench-1440.webp"');
  expect(imageMarkup).toContain('width="1440" height="960"');
  expect(imageMarkup).toContain('alt="Illustration: Zwei Erwachsene teilen einen goldenen Ideenfunken über einem offenen Buch, umgeben von farbigen Bausteinen."');
  expect(imageMarkup).toMatch(/loading="eager"[^>]*fetchPriority="high"[^>]*decoding="async"/);
});


it('adds exact fixed-source checks around the unchanged strict single original Spark capture', () => {
  const browser = source('e2e/spark-entry.pw.ts');
  expect(browser).toContain("const fixedHeroPath = '/images/home/forge-workbench-1440.webp'");
  for (const phase of ['observation', 'immediateAfter', 'after!']) {
    expect(browser).toContain(`expect(${phase}.state.currentSrc).toBe(fixedHeroPath)`);
  }
  expect(browser).toContain('expect(pixels.nonblank');
  expect(browser).toContain('expect(pixels.composition.matches');
});
