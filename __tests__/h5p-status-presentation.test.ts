import { getServerSession } from '@/lib/sites-auth/server';
import { GET } from '@/app/h5p/embed/[id]/route';
import { authorizedH5PContent } from '@/lib/server/h5p-access';
import { readH5PAsset } from '@/lib/server/h5p-storage';

jest.mock('next/server', () => ({
  NextResponse: class {
    status: number;
    headers: Map<string, string>;
    constructor(private body: string, init: { status?: number; headers: Record<string, string> }) {
      this.status = init.status ?? 200;
      this.headers = new Map(Object.entries(init.headers).map(([key, value]) => [key.toLowerCase(), value]));
    }
    async text() { return this.body; }
  },
}));

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/server/h5p-access', () => ({
  authorizedH5PContent: jest.fn(),
  createH5PAssetToken: () => 'fixture-token',
  h5pAppOrigin: (origin: string) => origin,
}));
jest.mock('@/lib/server/h5p-storage', () => ({ readH5PAsset: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'addEventListener').mockImplementation(() => {});
  jest.spyOn(window, 'postMessage').mockImplementation(() => {});
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'owner', role: 'INSTRUCTOR' } } as never);
  jest.mocked(authorizedH5PContent).mockResolvedValue({ title: 'Übung' } as never);
  jest.mocked(readH5PAsset).mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).H5PStandalone;
});

async function response() {
  return GET({ url: 'https://community.example.test/h5p/embed/package1' } as never, { params: Promise.resolve({ id: 'package1' }) });
}

function luminance(rgb: string) {
  const channels = rgb.match(/\d+/g)!.slice(0, 3).map(value => {
    const channel = Number(value) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

it.each(['loading', 'rejected', 'unavailable', 'ready'] as const)(
  'keeps the owned status readable and the package body unchanged when %s', async state => {
    const result = await response();
    expect(result.status).toBe(200);
    const parsed = new DOMParser().parseFromString(await result.text(), 'text/html');
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = parsed.body.innerHTML;
    const status = window.document.getElementById('h5p-status')!;
    if (state === 'rejected' || state === 'ready') {
      Object.assign(window, { H5PStandalone: { H5P: function () {
        return state === 'ready' ? Promise.resolve() : Promise.reject(new Error('Fixture load failure'));
      } } });
    }
    if (state !== 'loading') {
      window.eval(window.document.querySelector('script:not([src])')!.textContent!);
      await Promise.resolve();
      await Promise.resolve();
    }
    const style = window.getComputedStyle(status);
    expect(style.backgroundColor).toBe('rgb(239, 248, 246)');
    expect(style.color).toBe('rgb(20, 52, 61)');
    const contrast = (luminance(style.backgroundColor) + 0.05) / (luminance(style.color) + 0.05);
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    expect(contrast).toBeCloseTo(12.232, 3);
    expect(status.hidden).toBe(state === 'ready');
    expect(style.display === 'none').toBe(state === 'ready');
    expect(status.getAttribute('role')).toBe(state === 'rejected' || state === 'unavailable' ? 'alert' : 'status');
    if (state === 'rejected') expect(status.textContent).toContain('konnte nicht geladen werden');
    if (state === 'unavailable') expect(status.textContent).toContain('konnte nicht gestartet werden');
    const bodyStyle = window.getComputedStyle(window.document.body);
    expect(bodyStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(bodyStyle.color).toBe('rgb(24, 36, 59)');
  },
);

it.each([401, 404])('preserves the unstyled strict-CSP error response for %i', async status => {
  if (status === 401) jest.mocked(getServerSession).mockResolvedValue(null);
  else jest.mocked(readH5PAsset).mockRejectedValue(Object.assign(new Error('Missing fixture'), { code: 'ENOENT' }));
  const result = await response();
  expect(result.status).toBe(status);
  expect(result.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'; frame-ancestors 'self'");
  const html = await result.text();
  expect(html).toContain('<p role="alert">');
  expect(html).not.toMatch(/<style|style=/);
  expect(html).not.toContain('<script');
});
