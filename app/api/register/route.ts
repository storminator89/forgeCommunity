import { NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { z } from 'zod';

import prisma from '@/lib/prisma';
import {
  getClientAddress,
  isSameOriginRequest,
  normalizeEmail,
  readRequestBody,
  utf8ByteLength,
} from '@/lib/server/auth-security';
import {
  rateLimitHeaders,
  consumeRateLimit,
  REGISTER_RATE_LIMIT,
} from '@/lib/server/rate-limit';

const registerSchema = z.object({
  name: z.string()
    .trim()
    .min(1, 'Name ist erforderlich')
    .max(120, 'Name ist zu lang'),
  email: z.string()
    .trim()
    .email('Ungültige E-Mail-Adresse')
    .max(254, 'E-Mail-Adresse ist zu lang')
    .transform(normalizeEmail),
  password: z.string()
    .min(12, 'Passwort muss mindestens 12 Zeichen lang sein')
    .refine(
      password => utf8ByteLength(password) <= 72,
      'Passwort darf höchstens 72 UTF-8-Bytes lang sein',
    )
    .regex(/[A-Z]/, 'Mindestens ein Großbuchstabe erforderlich')
    .regex(/[a-z]/, 'Mindestens ein Kleinbuchstabe erforderlich')
    .regex(/[0-9]/, 'Mindestens eine Zahl erforderlich')
    .regex(/[^A-Za-z0-9]/, 'Mindestens ein Sonderzeichen erforderlich'),
});

const BCRYPT_ROUNDS = 12;
const MAX_AUTH_BODY_BYTES = 16 * 1024;

function tooManyRequests(result: ReturnType<typeof consumeRateLimit>) {
  return NextResponse.json(
    { message: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.' },
    { status: 429, headers: rateLimitHeaders(result) },
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      { message: 'Ungültige Anfragequelle.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const address = getClientAddress(req.headers);
  const addressLimit = consumeRateLimit(
    `register:ip:${address}`,
    REGISTER_RATE_LIMIT,
  );

  if (!addressLimit.allowed) return tooManyRequests(addressLimit);

  let json: unknown;
  try {
    const rawBody = await readRequestBody(req, MAX_AUTH_BODY_BYTES);
    if (rawBody === null) {
      return NextResponse.json(
        { message: 'Anfrage ist zu groß.' },
        { status: 413, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { message: 'Ungültiger JSON-Body.' },
      { status: 400 },
    );
  }

  const result = registerSchema.safeParse(json);

  if (!result.success) {
    return NextResponse.json(
      { message: result.error.issues[0]?.message ?? 'Ungültige Eingabe.' },
      { status: 400 },
    );
  }

  const { name, email, password } = result.data;
  const emailLimit = consumeRateLimit(
    `register:email:${email}`,
    REGISTER_RATE_LIMIT,
  );

  if (!emailLimit.allowed) return tooManyRequests(emailLimit);

  try {
    // Case insensitive lookup prevents duplicate accounts when an existing
    // database was created before registration normalized email addresses.
    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: 'E-Mail-Adresse wird bereits verwendet.' },
        { status: 400 },
      );
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
      select: { id: true },
    });

    return NextResponse.json(
      { message: 'Benutzer erfolgreich registriert.', userId: user.id },
      { status: 201 },
    );
  } catch (error) {
    // A concurrent registration can win between the lookup and create.
    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { message: 'E-Mail-Adresse wird bereits verwendet.' },
        { status: 400 },
      );
    }

    console.error('Registrierungsfehler:', error);
    return NextResponse.json(
      { message: 'Interner Serverfehler' },
      { status: 500 },
    );
  }
}
