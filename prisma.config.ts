import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 keeps connection URLs in the external config file. The fallback
// lets `prisma generate` run in CI and during image builds where no database
// credentials are available. Migrations still require DATABASE_URL to be set
// explicitly; the reserved placeholder cannot resolve to a real database.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --project prisma/tsconfig.seed.json prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://placeholder.invalid:5432/forge?schema=public',
  },
});
