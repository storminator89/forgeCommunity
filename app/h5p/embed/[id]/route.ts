import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import { authorizedH5PContent, createH5PAssetToken, h5pAppOrigin } from '@/lib/server/h5p-access';
import { H5PValidationError } from '@/lib/server/h5p-archive';
import { readH5PAsset } from '@/lib/server/h5p-storage';

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)); }
function safeJson(value: unknown) { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'); }

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) throw new H5PValidationError('Bitte melden Sie sich an, um den H5P-Inhalt zu öffnen.', 401);
    const { id } = await props.params;
    const origin = h5pAppOrigin(new URL(request.url).origin);
    const content = await authorizedH5PContent(id, session.user, origin);
    await readH5PAsset(id, ['h5p.json']);
    const token = createH5PAssetToken(id);
    const assetBase = `${origin}/api/h5p/assets/${id}/${token}`;
    const runtimeBase = `${origin}/h5p-runtime`;
    const options = { id, h5pJsonPath: assetBase, frameJs: `${runtimeBase}/frame.bundle.js`, frameCss: `${runtimeBase}/styles/h5p.css`, embedType: 'div', frame: false, fullScreen: true, export: false, embed: false, assetsRequestFetchOptions: { credentials: 'omit', mode: 'cors' } };
    const csp = [
      "sandbox allow-scripts allow-forms allow-downloads",
      "default-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'",
      `script-src 'unsafe-inline' ${runtimeBase}/ ${assetBase}/`,
      `style-src 'unsafe-inline' ${runtimeBase}/ ${assetBase}/`,
      `connect-src ${assetBase}/`,
      `img-src ${runtimeBase}/ ${assetBase}/ data: blob: https: http:`,
      `font-src ${runtimeBase}/ ${assetBase}/ data:`,
      `media-src ${assetBase}/ blob: https: http:`,
      `frame-src ${assetBase}/ https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com`,
      "object-src 'none'",
    ].join('; ');
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.title)}</title><link rel="stylesheet" href="${runtimeBase}/styles/h5p.css" crossorigin="anonymous"><style>html,body{margin:0;padding:0;background:transparent;color:#18243b;font:14px/1.5 system-ui,sans-serif}#h5p-player{width:100%;min-height:120px;box-sizing:border-box}#h5p-status{padding:20px}#h5p-status[hidden]{display:none}.h5p-content{border:0!important}</style></head><body><div id="h5p-status" role="status">Interaktiver Inhalt wird geladen…</div><div id="h5p-player"></div><script src="${runtimeBase}/main.bundle.js" crossorigin="anonymous"></script><script>
(function(){
  // The H5P core constructs its offline queue even when statistics are off.
  // Opaque sandbox origins cannot access Web Storage; keep this queue in
  // memory instead of relaxing the sandbox or exposing application storage.
  function memoryStorage(){var values=Object.create(null);return {get length(){return Object.keys(values).length;},key:function(index){return Object.keys(values)[index]||null;},getItem:function(key){key=String(key);return Object.prototype.hasOwnProperty.call(values,key)?values[key]:null;},setItem:function(key,value){values[String(key)]=String(value);},removeItem:function(key){delete values[String(key)];},clear:function(){values=Object.create(null);}};}
  ['localStorage','sessionStorage'].forEach(function(name){try{void window[name];}catch(error){Object.defineProperty(window,name,{configurable:true,value:memoryStorage()});}});
  var container=document.getElementById('h5p-player'),status=document.getElementById('h5p-status');
  var lastHeight=0;
  function resize(){var height=Math.min(10000,Math.max(160,Math.ceil(Math.max(container.scrollHeight,container.getBoundingClientRect().height)+(status.hidden?0:status.getBoundingClientRect().height))));if(height!==lastHeight){lastHeight=height;parent.postMessage({type:'forge:h5p:resize',height:height},window.location.origin);}}
  if(typeof ResizeObserver==='function')new ResizeObserver(resize).observe(container);
  window.addEventListener('load',resize);
  try{
    new H5PStandalone.H5P(container,${safeJson(options)}).then(function(){status.hidden=true;resize();if(window.H5P&&H5P.externalDispatcher)H5P.externalDispatcher.on('resize',resize);}).catch(function(){status.hidden=false;status.setAttribute('role','alert');status.textContent='Der H5P-Inhalt konnte nicht geladen werden. Bitte laden Sie die Kursseite neu.';resize();});
  }catch(error){status.setAttribute('role','alert');status.textContent='Der H5P-Player konnte nicht gestartet werden. Bitte laden Sie die Kursseite neu.';resize();}
})();
</script></body></html>`;
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' } });
  } catch (error) {
    const status = error instanceof H5PValidationError ? error.status : (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 404 : 500;
    const message = error instanceof H5PValidationError ? error.message : status === 404 ? 'Die H5P-Paketdateien fehlen. Bitte importieren Sie die Datei erneut.' : 'Der H5P-Inhalt konnte nicht geladen werden.';
    if (status === 500) console.error('Failed to initialize H5P player:', error);
    return new NextResponse(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>H5P-Inhalt</title><body><p role="alert">${escapeHtml(message)}</p></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'self'", 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
}
