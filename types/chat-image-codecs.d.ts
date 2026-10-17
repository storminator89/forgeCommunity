/** Exact server-only codec entry points used by the private Chat pipeline. */
declare module 'jpeg-js/lib/decoder.js' {
  const decode: typeof import('jpeg-js').decode;
  export default decode;
}

declare module 'pngjs/browser.js' {
  import type { Buffer } from 'node:buffer';

  interface PixelImage {
    data: Uint8Array;
    width: number;
    height: number;
  }

  const pngBrowser: {
    PNG: {
      sync: {
        read(input: Buffer, options: { checkCRC: true }): PixelImage;
        write(input: PixelImage, options: {
          colorType: 6;
          inputColorType: 6;
          inputHasAlpha: true;
          bitDepth: 8;
          filterType: 0;
          deflateLevel: 6;
        }): Uint8Array;
      };
    };
  };
  export default pngBrowser;
}
