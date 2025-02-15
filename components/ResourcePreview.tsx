import React, { useState, useEffect } from 'react';
import { Loader2, Video, Download, Eye, FileText } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'react-toastify';
import { clsx } from 'clsx';
import dynamic from 'next/dynamic';
import Script from 'next/script';

// Dynamischer Import von pdfjs-dist
const pdfjsLib = dynamic(() => import('pdfjs-dist'), { ssr: false });

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
    
    // YouTube
    if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
      const id = urlObj.hostname.includes('youtu.be') 
        ? urlObj.pathname.slice(1)
        : urlObj.searchParams.get('v');
      return { type: 'youtube', id };
    }
    
    // Vimeo
    if (urlObj.hostname.includes('vimeo.com')) {
      const id = urlObj.pathname.split('/')[1];
      return { type: 'vimeo', id };
    }
    
    // Dailymotion
    if (urlObj.hostname.includes('dailymotion.com')) {
      const id = urlObj.pathname.split('/')[2]?.split('_')[0];
      return { type: 'dailymotion', id };
    }
  } catch (e) {
    console.error('Error parsing video URL:', e);
  }
  
  return { type: null, id: null };
};

export function ResourcePreview({ url, type }: ResourcePreviewProps) {
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

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchPreview = async () => {
      try {
        setLoading(true);
        setError(null);

        // Prüfe auf Video-URLs
        if (type === 'VIDEO') {
          const provider = getVideoProvider(url);
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

        // Validiere URL
        try {
          new URL(url);
        } catch (e) {
          throw new Error('Ungültige URL');
        }

        const response = await fetch('/api/resources/preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url }),
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
            title: data.title || 'Keine Überschrift verfügbar',
            description: data.description || 'Keine Beschreibung verfügbar',
            image: data.image
          });
        }
      } catch (err) {
        if (isMounted && err instanceof Error) {
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
  }, [url, type]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-80 bg-gray-50 dark:bg-gray-800/50">
        <div className="space-y-4 w-full px-6">
          <div className="animate-pulse flex space-x-4">
            <div className="flex-1 space-y-4 py-1">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-80 flex flex-col items-center justify-center text-gray-500 bg-gray-50 dark:bg-gray-800/50">
        <svg
          className="h-12 w-12 text-gray-400 mb-3"
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
        <button 
          onClick={() => window.open(url, '_blank')}
          className="mt-4 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline"
        >
          Direkt zur Quelle
        </button>
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
      <div className="relative h-80 bg-gray-900">
        <iframe
          src={embedUrls[videoProvider.type]}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Video Preview"
        />
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent to-black/10" />
      </div>
    );
  }

  // PDF Preview
  if (type === 'PDF') {
    const [isPdfLoading, setIsPdfLoading] = useState(true);
    const [pdfError, setPdfError] = useState<string | null>(null);
    const iframeRef = React.useRef<HTMLIFrameElement>(null);

    useEffect(() => {
      const loadPdf = async () => {
        try {
          setIsPdfLoading(true);
          setPdfError(null);

          // Prüfe ob die PDF-URL gültig ist
          const response = await fetch(url, { method: 'HEAD' });
          if (!response.ok) {
            throw new Error('PDF konnte nicht geladen werden');
          }

          // Setze den Content-Type Header für die PDF-Anzeige
          if (iframeRef.current) {
            iframeRef.current.src = url + '#toolbar=0&navpanes=0';
          }

          setIsPdfLoading(false);
        } catch (err) {
          console.error('Error loading PDF:', err);
          setPdfError(err instanceof Error ? err.message : 'Fehler beim Laden des PDFs');
        }
      };

      loadPdf();
    }, [url]);

    return (
      <div className="h-80 relative bg-gray-50 dark:bg-gray-800/50 group">
        <div className="absolute inset-0">
          {/* Native PDF Viewer */}
          <iframe
            ref={iframeRef}
            className="w-full h-full"
            style={{ backgroundColor: 'white' }}
          />
          
          {/* Loading State */}
          {isPdfLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-800/50">
              <div className="flex flex-col items-center">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-2" />
                <p className="text-sm text-gray-500">PDF wird geladen...</p>
              </div>
            </div>
          )}

          {/* Error State */}
          {pdfError && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-800/50">
              <div className="text-center p-6">
                <FileText className="mx-auto h-12 w-12 text-gray-400 mb-3" />
                <p className="text-sm text-gray-500 mb-4">{pdfError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(url, '_blank')}
                >
                  Im Browser öffnen
                </Button>
              </div>
            </div>
          )}

          {/* Info Overlay on Hover */}
          <div 
            className={clsx(
              "absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300",
              "opacity-0 group-hover:opacity-100 flex items-center justify-center",
              isPdfLoading || pdfError ? "pointer-events-none" : ""
            )}
          >
            <div className="bg-white/90 dark:bg-gray-800/90 p-4 rounded-lg shadow-lg space-y-4 transform scale-95 group-hover:scale-100 transition-transform duration-300">
              <h3 className="text-lg font-medium text-gray-900 dark:text-gray-200 text-center">
                {previewData?.title || url.split('/').pop() || 'PDF Dokument'}
              </h3>
              {previewData?.fileSize && (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                  Größe: {previewData.fileSize}
                </p>
              )}
              <div className="flex justify-center space-x-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center space-x-2"
                  onClick={() => window.open(url, '_blank')}
                >
                  <Eye className="h-4 w-4" />
                  <span>Öffnen</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex items-center space-x-2"
                  onClick={handleDownload}
                >
                  <Download className="h-4 w-4" />
                  <span>Download</span>
                </Button>
              </div>
            </div>
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
          <img
            src={previewData.image}
            alt={previewData.title || 'Preview'}
            className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            onError={() => setImageError(true)}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-6">
            <div className="relative z-10">
              {previewData.title && (
                <div className="space-y-2 backdrop-blur-sm bg-black/20 p-4 rounded-lg">
                  <p className="text-white text-lg font-semibold leading-tight drop-shadow-lg">
                    {previewData.title}
                  </p>
                  {previewData.description && (
                    <p className="text-white text-sm leading-relaxed line-clamp-2 drop-shadow-lg">
                      {previewData.description}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-gray-800/50 p-6">
          <div className="text-center max-w-lg p-6 rounded-lg bg-white/50 dark:bg-black/20 backdrop-blur-sm">
            <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed font-medium">
              {previewData?.description || previewData?.title || 'Keine Vorschau verfügbar'}
            </p>
          </div>
        </div>
      )}
      <div className="absolute inset-0 border-2 border-transparent group-hover:border-blue-500/20 transition-colors duration-300 pointer-events-none rounded-lg"></div>
    </div>
  );
}