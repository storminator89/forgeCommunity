declare namespace Cloudflare {
  interface Env {
    DB?: import('@cloudflare/workers-types').D1Database;
    BUCKET?: import('@cloudflare/workers-types').R2Bucket;
  }
}

// Use importable Worker types so browser code keeps the DOM APIs rather than
// inheriting incompatible global Worker Response/URL declarations.
declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
}
