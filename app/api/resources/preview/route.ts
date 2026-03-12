import { NextResponse } from 'next/server';
import { JSDOM } from 'jsdom';

import { sanitizeTextServer } from '@/lib/server/sanitize-html';
import { assertSafePublicUrl } from '@/lib/server/url-security';

const PREVIEW_TIMEOUT_MS = 5000;

const getPdfMetadata = async (url: URL) => {
  try {
    const response = await fetch(url.toString(), {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS)
    }).catch(e => {
      console.error(`Fetch error for ${url.toString()}:`, e);
      return null;
    });

    if (!response) return null;

    if (response.status >= 300 && response.status < 400) {
      return null; // Weiterleitungen ignorieren
    }

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    const lastModified = response.headers.get('last-modified');
    const fileName = decodeURIComponent(url.pathname.split('/').pop() || 'document.pdf');

    if (contentType?.includes('application/pdf')) {
      const fileSizeInMB = contentLength ? Math.round(parseInt(contentLength) / (1024 * 1024) * 10) / 10 : null;

      return {
        title: fileName,
        type: 'pdf',
        description: `PDF Dokument${fileSizeInMB ? ` (${fileSizeInMB} MB)` : ''}`,
        lastModified: lastModified || null,
        fileSize: fileSizeInMB ? `${fileSizeInMB} MB` : null,
      };
    }
    return null;
  } catch (e) {
    console.error('Error fetching PDF metadata:', e);
    return null;
  }
};

const getVideoMetadata = async (url: string) => {
  try {
    const urlObj = new URL(url);

    // YouTube
    if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
      const videoId = urlObj.hostname.includes('youtu.be')
        ? urlObj.pathname.slice(1)
        : urlObj.searchParams.get('v');

      const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS)
      }).catch(e => {
        console.error(`YouTube fetch error for ${videoId}:`, e);
        return null;
      });

      if (!response) return null;

      if (response.status >= 300 && response.status < 400) {
        return null; // Weiterleitungen ignorieren
      }

      if (response.ok) {
        const data = await response.json();
        return {
          title: data.title,
          description: data.author_name,
          image: data.thumbnail_url,
          type: 'video'
        };
      }
    }

    // Vimeo
    if (urlObj.hostname.includes('vimeo.com')) {
      const videoId = urlObj.pathname.split('/')[1];
      const response = await fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${videoId}`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS)
      }).catch(e => {
        console.error(`Vimeo fetch error for ${videoId}:`, e);
        return null;
      });

      if (!response) return null;

      if (response.status >= 300 && response.status < 400) {
        return null; // Weiterleitungen ignorieren
      }

      if (response.ok) {
        const data = await response.json();
        return {
          title: data.title,
          description: data.author_name,
          image: data.thumbnail_url,
          type: 'video'
        };
      }
    }

    return null;
  } catch (e) {
    console.error('Error fetching video metadata:', e);
    return null;
  }
};

const getHtmlMetadata = async (url: URL) => {
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'user-agent': 'forge-community-preview/1.0',
        accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
    }).catch((error) => {
      console.error(`HTML fetch error for ${url.toString()}:`, error);
      return null;
    });

    if (!response || !response.ok) {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return null;
    }

    const html = (await response.text()).slice(0, 250000);
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const getMetaContent = (...selectors: string[]) => {
      for (const selector of selectors) {
        const value = document.querySelector(selector)?.getAttribute('content');
        if (value) {
          return sanitizeTextServer(value);
        }
      }

      return '';
    };

    const resolvePreviewUrl = (value: string) => {
      if (!value) {
        return null;
      }

      try {
        return new URL(value, url).toString();
      } catch {
        return null;
      }
    };

    const title =
      getMetaContent('meta[property="og:title"]', 'meta[name="twitter:title"]') ||
      sanitizeTextServer(document.title) ||
      url.hostname;
    const description =
      getMetaContent('meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]') ||
      '';
    const image = resolvePreviewUrl(
      getMetaContent('meta[property="og:image"]', 'meta[name="twitter:image"]')
    );

    return {
      title,
      description,
      image,
      type: 'link',
    };
  } catch (error) {
    console.error('Error fetching HTML metadata:', error);
    return null;
  }
};

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { error: 'URL ist erforderlich' },
        { status: 400 }
      );
    }

    const safeUrl = await assertSafePublicUrl(url);

    if (safeUrl.toString().toLowerCase().endsWith('.pdf')) {
      const pdfMetadata = await getPdfMetadata(safeUrl);
      if (pdfMetadata) {
        return NextResponse.json(pdfMetadata);
      }
    }

    // Dann auf Video prüfen
    const videoMetadata = await getVideoMetadata(url);
    if (videoMetadata) {
      return NextResponse.json(videoMetadata);
    }

    // Fallback auf allgemeine Link-Vorschau
    const previewData = await getHtmlMetadata(safeUrl);

    if (!previewData) {
      return NextResponse.json(
        { error: 'Für diese URL konnte keine Vorschau geladen werden' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      title: previewData.title,
      description: previewData.description,
      image: previewData.image,
      type: previewData.type
    });
  } catch (error) {
    console.error('Preview error:', error);
    return NextResponse.json(
      { error: 'Fehler beim Laden der Vorschau' },
      { status: 500 }
    );
  }
}
