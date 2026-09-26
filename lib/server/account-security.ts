import { createHmac, timingSafeEqual } from 'node:crypto';

import { utf8ByteLength } from './auth-security';
import { z } from 'zod';

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= 12 &&
    utf8ByteLength(value) <= 72 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value);
}

const password = z.string().refine(validPassword);
const optionalText = z.string().max(10_000).nullable().optional();
const settings = z.object({
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  theme: z.enum(['LIGHT', 'DARK']).optional(),
  language: z.string().max(20).optional(),
}).optional();

export const adminUserInput = z.object({
  email: z.string().trim().pipe(z.email().max(254)).transform(value => value.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  password: password.optional(),
  role: z.enum(['USER', 'ADMIN', 'MODERATOR', 'INSTRUCTOR']).optional(),
  title: z.string().max(500).nullable().optional(),
  bio: optionalText,
  contact: optionalText,
  image: optionalText,
  settings,
});

// Bind a credentials session to the stored password hash without exposing the
// hash in the (signed but client-readable) JWT.
export function passwordFingerprint(userId: string, passwordHash: string): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is required for credentials sessions');
  return createHmac('sha256', secret)
    .update(userId).update('\0').update(passwordHash)
    .digest('hex');
}

export function samePasswordFingerprint(left: unknown, right: string): boolean {
  if (typeof left !== 'string' || !/^[0-9a-f]{64}$/.test(left)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
