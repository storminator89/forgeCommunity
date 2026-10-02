import React, { useState, useEffect } from 'react';
import { Loader2, Download, Eye, FileText } from 'lucide-react';
import { Button } from './ui/button';
import Image from 'next/image';
import { getSafeNavigationUrl } from '@/lib/security';

interface ResourcePreviewProps {
  url: string;
  type: string;
}

type VideoProvider = {
  type: 'youtube' | 'vimeo' | 'dailymotion' | null;
  id: string | null;
};

const getVideoProvider = (url: string): VideoProvider => {
  try {
    const urlObj = new URL(url);
    if (!getSafeNavigationUrl(url) || !['http:', 'https:'].includes(urlObj.protocol)) return { type: null, id: null };
    const hostname = urlObj.hostname.toLowerCase();

    // YouTube
    if (['youtube.com', 'www.youtube.com', 'youtu.be'].includes(hostname)) {
      const id = hostname === 'youtu.be'
        ? urlObj.pathname.slice(1)
        : urlObj.searchParams.get('v');
      return { type: 'youtube', id: id && /^[\w-]{1,128}$/.test(id) ? id : null };
    }

    // Vimeo
    if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(hostname)) {
      const id = urlObj.pathname.split('/')[1];
      const videoId = hostname === 'player.vimeo.com' ? urlObj.pathname.split('/')[2] : id;
      return { type: 'vimeo', id: videoId && /^\d{1,20}$/.test(videoId) ? videoId : null };
    }

    // Dailymotion
    if (['dailymotion.com', 'www.dailymotion.com'].includes(hostname)) {
      const id = urlObj.pathname.split('/')[2]?.split('_')[0];
      return { type: 'dailymotion', id: id && /^[\w-]{1,128}$/.test(id) ? id : null };
    }
  } catch (e) {
    console.error('Error parsing video URL:', e);
  }

  return { type: null, id: null };
};

export function ResourcePreview({ url, type }: ResourcePreviewProps) {
  const safeUrl = getSafeNavigationUrl(url);
  const [previewData, setPreviewData] = useState<{
    title?: string;
    description?: string;
    image?: string;
    fileSize?: string;
    lastModified?: string;
    type?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [videoProvider, setVideoProvider] = useState<VideoProvider>({ type: null, id: null });

  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  const handleDownload = () => {
    if (!safeUrl) return;
    const link = document.createElement('a');
    link.href = safeUrl;
    link.download = safeUrl.split('/').pop() || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchPreview = async () => {
      try {
        setLoading(true);
        setError(null);
        if (!safeUrl) throw new Error('Ungültige URL');

        // Prüfe auf Video-URLs
        if (type === 'VIDEO') {
          const provider = getVideoProvider(safeUrl);
          if (provider.type && provider.id) {
            setVideoProvider(provider);
            setLoading(false);
            return;
          }
        }

        if (type === 'PDF') {
          setPreviewData({ title: 'PDF Dokument', description: 'PDF Vorschau' });
          setLoading(false);
          return;
        }

        const response = await fetch('/api/resources/preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: safeUrl }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error('Vorschau konnte nicht geladen werden');
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(data.error);
        }

        if (isMounted) {
          setPreviewData({
            title: data.title || undefined,
            description: data.description || undefined,
            image: data.image
          });
        }
      } catch (err: any) {
        if (isMounted && err.name !== 'AbortError') {
          setError(err.message);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchPreview();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [url, type, safeUrl]);

  useEffect(() => {
    if (type !== 'PDF' || !safeUrl) return;

    const loadPdf = async () => {
      try {
        setIsPdfLoading(true);
        setPdfError(null);

        // Prüfe ob die PDF-URL gültig ist
        const response = await fetch(safeUrl, { method: 'HEAD' });
        if (!response.ok) {
          throw new Error('PDF konnte nicht geladen werden');
        }

        // Setze den Content-Type Header für die PDF-Anzeige
        if (iframeRef.current) {
          iframeRef.current.src = safeUrl + '#toolbar=0&navpanes=0';
        }

        setIsPdfLoading(false);
      } catch (err: any) {
        console.error('Error loading PDF:', err);
        setPdfError(err.message || 'Fehler beim Laden des PDFs');
        setIsPdfLoading(false);
      }
    };

    loadPdf();
  }, [type, safeUrl]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-80 bg-card/50">
        <div className="space-y-4 w-full px-6">
          <div className="animate-pulse flex space-x-4">
            <div className="flex-1 space-y-4 py-1">
              <div className="h-4 bg-muted rounded w-3/4"></div>
              <div className="space-y-2">
                <div className="h-4 bg-muted rounded"></div>
                <div className="h-4 bg-muted rounded w-5/6"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-80 flex flex-col items-center justify-center text-muted-foreground bg-card/50">
        <svg
          className="h-12 w-12 text-muted-foreground mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <p className="text-center">{error}</p>
        {safeUrl && <button
          onClick={() => window.open(safeUrl, '_blank', 'noopener,noreferrer')}
          className="mt-4 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline"
        >
          Direkt zur Quelle
        </button>}
      </div>
    );
  }

  // Video Preview
  if (type === 'VIDEO' && videoProvider.type && videoProvider.id) {
    const embedUrls = {
      youtube: `https://www.youtube.com/embed/${videoProvider.id}`,
      vimeo: `https://player.vimeo.com/video/${videoProvider.id}`,
      dailymotion: `https://www.dailymotion.com/embed/video/${videoProvider.id}`
    };

    return (
      <div className="relative h-80 bg-card">
        <iframe
          src={embedUrls[videoProvider.type]}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Video Preview"
        />
      </div>
    );
  }

  // PDF Preview
  if (type === 'PDF') {
    return (
      <div className="h-80 flex flex-col bg-card">
        <div className="relative min-h-0 flex-1">
          <iframe
            ref={iframeRef}
            src={safeUrl ? `${safeUrl}#toolbar=0&navpanes=0` : undefined}
            title="PDF-Vorschau"
            className="w-full h-full bg-white"
          />
          {isPdfLoading && (
            <div role="status" className="absolute inset-0 flex items-center justify-center bg-card/90">
              <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">PDF wird geladen…</p>
            </div>
          )}
          {pdfError && (
            <div role="alert" className="absolute inset-0 flex items-center justify-center bg-card">
              <div className="text-center p-6">
                <FileText className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">{pdfError}</p>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-card px-3 py-2">
          <span className="min-w-0 truncate text-sm text-muted-foreground">PDF</span>
          {previewData?.fileSize && <span className="text-sm text-muted-foreground">{previewData.fileSize}</span>}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!safeUrl} onClick={() => safeUrl && window.open(safeUrl, '_blank', 'noopener,noreferrer')}>
              <Eye className="mr-2 h-4 w-4" />Öffnen
            </Button>
            <Button variant="outline" size="sm" disabled={!safeUrl} onClick={handleDownload}>
              <Download className="mr-2 h-4 w-4" />Download
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Standard Preview
  return (
    <div className="h-80 overflow-hidden group relative">
      {previewData?.image && !imageError ? (
        <div className="relative h-full">
          <Image
            src={previewData.image}
            alt={previewData.title || 'Preview'}
            className="w-full h-full object-cover"
            fill
            onError={() => setImageError(true)}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-6">
            <div className="relative z-10">
              {previewData.title && (
                <div className="space-y-2">
                  <p className="text-white text-lg font-semibold leading-tight">
                    {previewData.title}
                  </p>
                  {previewData.description && (
                    <p className="text-white text-sm leading-relaxed line-clamp-2">
                      {previewData.description}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="h-full flex items-center justify-center bg-card/50 p-6">
          <div className="text-center max-w-lg">
            <p className="text-base text-foreground dark:text-muted-foreground leading-relaxed font-medium">
              {previewData?.description || previewData?.title || 'Keine Vorschau verfügbar'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
