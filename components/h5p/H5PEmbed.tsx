'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const subscribeOrigin = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => '';

export function H5PEmbed({ src, title }: { src: string; title: string }) {
  return <H5PFrame key={src} src={src} title={title} />;
}

function H5PFrame({ src, title }: { src: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(480);
  const origin = useSyncExternalStore(subscribeOrigin, getOrigin, getServerOrigin);
  // Imported libraries execute in an opaque sandbox, separated from application cookies.
  const local = src.startsWith('/') || Boolean(origin && new URL(src, origin).origin === origin);

  useEffect(() => {
    function send(action: string) {
      frame.current?.contentWindow?.postMessage({ context: 'h5p', action }, '*');
    }
    function resize(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      const data = event.data;
      if (data.context === 'h5p' && data.action === 'hello') { send('hello'); return; }
      if (data.context === 'h5p' && data.action === 'prepareResize') {
        if (typeof data.clientHeight === 'number' && Number.isFinite(data.clientHeight) && data.clientHeight >= 1 && data.clientHeight <= 12000) {
          const preparedHeight = Math.max(180, Math.ceil(data.clientHeight));
          // Apply before replying: the embedded player measures its body next.
          if (frame.current) frame.current.style.height = `${preparedHeight}px`;
          setHeight(preparedHeight);
        }
        send('resizePrepared'); return;
      }
      if (data.type !== 'forge:h5p:resize' && !(data.context === 'h5p' && data.action === 'resize')) return;
      const nextHeight = data.type === 'forge:h5p:resize' ? data.height : data.scrollHeight ?? data.height;
      if (typeof nextHeight !== 'number' || !Number.isFinite(nextHeight) || nextHeight < 1 || nextHeight > 12000) return;
      setHeight(Math.max(180, Math.ceil(nextHeight)));
    }
    const requestResize = () => send('resize');
    window.addEventListener('message', resize);
    window.addEventListener('resize', requestResize);
    return () => { window.removeEventListener('message', resize); window.removeEventListener('resize', requestResize); };
  }, []);

  return <iframe ref={frame} src={src} title={title} style={{ height }} className="w-full rounded-md border border-border bg-background" sandbox={local ? 'allow-scripts allow-forms allow-downloads' : 'allow-scripts allow-forms allow-downloads allow-same-origin'} allow="fullscreen; autoplay" allowFullScreen referrerPolicy="no-referrer" onLoad={() => frame.current?.contentWindow?.postMessage({ context: 'h5p', action: 'ready' }, '*')} />;
}
