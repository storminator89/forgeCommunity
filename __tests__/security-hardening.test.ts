import {
  getSafeEmbedUrl,
  getYouTubeEmbedUrl,
  isAllowedAudioUrl,
  isAllowedVideoUrl,
} from '@/lib/security';
import { ReadableStream } from 'node:stream/web';
import { isSafeRichHtmlUrl } from '@/lib/html-sanitize-config';
import { sanitizeRichHtmlServer } from '@/lib/server/sanitize-html';
import { assertSafePublicUrl } from '@/lib/server/url-security';
import { requestWithBodyLimit, RequestBodyLimitError } from '@/lib/server/request-body';
import { deleteUploadedImage, saveImageUpload } from '@/lib/server/image-upload';
import { access, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

describe('embed URL validation', () => {
  it('rejects protocol-relative and non-web schemes', () => {
    expect(getSafeEmbedUrl('//attacker.example/video', 'video')).toBeNull();
    expect(getSafeEmbedUrl('javascript:alert(1)', 'audio')).toBeNull();
    expect(getSafeEmbedUrl('\\\\attacker.example\\video', 'video')).toBeNull();
  });

  it('requires an exact trusted HTTPS hostname', () => {
    expect(isAllowedVideoUrl('https://youtube.com/watch?v=abc123')).toBe(true);
    expect(isAllowedVideoUrl('https://youtube.com.attacker.example/watch?v=abc123')).toBe(false);
    expect(isAllowedVideoUrl('http://youtube.com/watch?v=abc123')).toBe(true);
    expect(isAllowedAudioUrl('//soundcloud.com/track')).toBe(false);
  });

  it('only creates embeds from a constrained YouTube video ID', () => {
    expect(getYouTubeEmbedUrl('https://www.youtube.com/watch?v=abc_123')).toBe(
      'https://www.youtube.com/embed/abc_123',
    );
    expect(getYouTubeEmbedUrl('https://www.youtube.com/watch?v=abc/def')).toBeNull();
  });
});

describe('rich HTML URL policy', () => {
  it('rejects protocol-relative and data URLs', () => {
    expect(isSafeRichHtmlUrl('//attacker.example', 'href')).toBe(false);
    expect(isSafeRichHtmlUrl('data:text/html,<script>alert(1)</script>', 'href')).toBe(false);
    expect(isSafeRichHtmlUrl('data:image/png;base64,abc', 'src')).toBe(false);
  });

  it('allows ordinary links and local image paths', () => {
    expect(isSafeRichHtmlUrl('https://example.com/docs', 'href')).toBe(true);
    expect(isSafeRichHtmlUrl('/images/uploads/example.png', 'src')).toBe(true);
    expect(isSafeRichHtmlUrl('mailto:hello@example.com', 'href')).toBe(true);
  });

  it('removes protocol-relative and data URLs during server sanitization', () => {
    const sanitized = sanitizeRichHtmlServer(
      '<a href="//attacker.example">bad</a><img src="data:image/png;base64,abc"><img src="/images/ok.png">',
    );
    expect(sanitized).not.toContain('attacker.example');
    expect(sanitized).not.toContain('data:image');
    expect(sanitized).toContain('/images/ok.png');
  });
});

describe('server URL and request boundaries', () => {
  it('blocks IPv4-mapped IPv6 loopback literals', async () => {
    await expect(assertSafePublicUrl('http://[::ffff:127.0.0.1]/')).rejects.toThrow(
      'Private oder lokale Netzwerkziele',
    );
  });

  it('limits chunked request bodies before multipart parsing', async () => {
    const request = {
      url: 'http://example.test/upload',
      method: 'POST',
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          controller.close();
        },
      }),
    } as unknown as Request;

    await expect(requestWithBodyLimit(request, 3)).rejects.toBeInstanceOf(RequestBodyLimitError);
  });

  it('rejects image bytes whose magic does not match the declared MIME type', async () => {
    const file = {
      type: 'image/png',
      size: 3,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as unknown as File;
    await expect(saveImageUpload(file, 'test')).rejects.toThrow('Dateiinhalt entspricht');
  });

  it('decodes and normalizes a real image before writing it', async () => {
    const bytes = Uint8Array.from(Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ));
    const file = {
      type: 'image/png',
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.slice().buffer,
    } as unknown as File;

    const publicPath = await saveImageUpload(file, 'test');
    expect(publicPath).toMatch(/^\/images\/uploads\/test-[0-9a-f-]+\.png$/);
    await unlink(path.join(process.cwd(), 'public', publicPath));
  });

  it('does not delete files outside the upload directory through a sibling prefix', async () => {
    const sibling = path.join(process.cwd(), 'public', 'images', 'uploads-sibling-test');
    const siblingFile = path.join(sibling, 'keep.png');
    await mkdir(sibling, { recursive: true });
    await writeFile(siblingFile, 'keep');

    try {
      await deleteUploadedImage('/images/uploads/../uploads-sibling-test/keep.png');
      await expect(access(siblingFile)).resolves.toBeUndefined();
    } finally {
      await rm(sibling, { recursive: true, force: true });
    }
  });
});
