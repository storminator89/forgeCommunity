// lib/prisma.ts

import { PrismaClient } from '@/generated/prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';
import { env } from 'cloudflare:workers';
import { getHeadersContext } from 'vinext/shims/headers';

// Prisma's initialization/query promises must belong to the current Worker
// request. Sharing a client between concurrent requests can cancel their I/O.
const requestClients = new WeakMap<object, PrismaClient>();

function getPrismaClient(): PrismaClient {
  if (!env.DB) throw new Error('Cloudflare D1 binding DB is unavailable.');
  const request = getHeadersContext()?.headers;
  if (!request) return new PrismaClient({ adapter: new PrismaD1(env.DB) });
  let client = requestClients.get(request);
  if (!client) {
    client = new PrismaClient({ adapter: new PrismaD1(env.DB) });
    requestClients.set(request, client);
  }
  return client;
}

const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export default prisma;
