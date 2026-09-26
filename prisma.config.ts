import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const provider = process.env.DATABASE_PROVIDER ?? 'postgresql';
if (provider !== 'postgresql' && provider !== 'sqlite') {
  throw new Error('DATABASE_PROVIDER must be either "postgresql" or "sqlite".');
}

// Prisma 7 keeps connection URLs in the external config file. The fallback
// lets `prisma generate` run in CI and during image builds where no database
// credentials are available. Migrations still require DATABASE_URL to be set
// explicitly; the reserved placeholder cannot resolve to a real database.
export default defineConfig({
  schema: provider === 'sqlite' ? 'prisma/schema.sqlite.prisma' : 'prisma/schema.prisma',
  migrations: {
    path: provider === 'sqlite' ? 'prisma/sqlite-migrations' : 'prisma/migrations',
    seed: 'ts-node --project prisma/tsconfig.seed.json prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? (provider === 'sqlite'
      ? 'file:./dev.db'
      : 'postgresql://placeholder.invalid:5432/forge?schema=public'),
  },
});
