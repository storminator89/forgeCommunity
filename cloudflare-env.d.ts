declare namespace Cloudflare {
  interface Env {
    DB?: import('@cloudflare/workers-types').D1Database;
    BUCKET?: import('@cloudflare/workers-types').R2Bucket;
    OAUTH_BASE_URL?: string;
    OAUTH_TRANSACTION_MIGRATION_READY?: string;
    OAUTH_STATE_SECRET?: string;
    OAUTH_CONFIG_ENCRYPTION_KEY?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    OIDC_ISSUER?: string;
    OIDC_CLIENT_ID?: string;
    OIDC_CLIENT_SECRET?: string;
    OIDC_NAME?: string;
    OIDC_TOKEN_AUTH_METHOD?: string;
    OIDC_ALLOWED_ENDPOINT_ORIGINS?: string;
  }
}

// Use importable Worker types so browser code keeps the DOM APIs rather than
// inheriting incompatible global Worker Response/URL declarations.
declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
}
