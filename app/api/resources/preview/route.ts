import { NextResponse } from 'next/server';
import { getLinkPreview } from 'link-preview-js';

const getPdfMetadata = async (url: string) => {
  try {
    const response = await fetch(url, { 
      method: 'HEAD',
      redirect: 'manual',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(5000)
    }).catch(e => {
      console.error('Fetch error:', e);
      return null;
    });
    
    if (response.status >= 300 && response.status < 400) {
      return null; // Weiterleitungen ignorieren
    }
    
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    const lastModified = response.headers.get('last-modified');
    const fileName = decodeURIComponent(url.split('/').pop() || 'document.pdf');

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
        redirect: 'manual',
        credentials: 'same-origin',
        signal: AbortSignal.timeout(5000)
      }).catch(e => {
        console.error('YouTube fetch error:', e);
        return null;
      });
      
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
        redirect: 'manual',
        credentials: 'same-origin',
        signal: AbortSignal.timeout(5000)
      }).catch(e => {
        console.error('Vimeo fetch error:', e);
        return null;
      });
      
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

export async function POST(request: Request) {
  try {
    const { url } = await request.json();
    
    if (!url) {
      return NextResponse.json(
        { error: 'URL ist erforderlich' },
        { status: 400 }
      );
    }

    // Prüfe zuerst auf PDF
    if (url.toLowerCase().endsWith('.pdf')) {
      const pdfMetadata = await getPdfMetadata(url);
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
    const previewData = await getLinkPreview(url, {
      timeout: 5000,
      headers: {
        'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)',
      },
    });

    return NextResponse.json({
      title: previewData.title,
      description: previewData.description,
      image: previewData.images?.[0] || null,
      type: 'link'
    });
  } catch (error) {
    console.error('Preview error:', error);
    return NextResponse.json(
      { error: 'Fehler beim Laden der Vorschau' },
      { status: 500 }
    );
  }
}