// lib/prisma.ts

import { PrismaClient } from '@prisma/client';

declare global {
  // Ermöglicht globale Variablen ohne TypeScript-Fehler
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const prisma = global.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') global.prisma = prisma;

export default prisma;
