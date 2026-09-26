import 'server-only';

import { NextResponse } from 'next/server';
import { RequestBodyLimitError, requestWithBodyLimit } from './request-body';

export class InvalidJsonBodyError extends Error {
  constructor() {
    super('Expected a JSON object');
    this.name = 'InvalidJsonBodyError';
  }
}

export class InvalidPaginationError extends Error {
  constructor() {
    super('Invalid pagination parameters');
    this.name = 'InvalidPaginationError';
  }
}

export function readPage(request: Request, pageSize = 50): { skip: number; take: number } {
  const params = new URL(request.url).searchParams;
  const rawPage = params.get('page') ?? '1';
  if (!/^[1-9]\d*$/.test(rawPage)) throw new InvalidPaginationError();
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger((page - 1) * pageSize)) {
    throw new InvalidPaginationError();
  }
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export async function readJsonObject(request: Request, maxBytes = 256 * 1024): Promise<Record<string, unknown>> {
  const bounded = await requestWithBodyLimit(request, maxBytes);
  let value: unknown;
  try {
    value = await bounded.json();
  } catch {
    throw new InvalidJsonBodyError();
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidJsonBodyError();
  }
  return value as Record<string, unknown>;
}

export function requestErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof RequestBodyLimitError) {
    return NextResponse.json({ error: 'Request body is too large' }, { status: 413 });
  }
  if (error instanceof InvalidJsonBodyError) {
    return NextResponse.json({ error: 'Invalid JSON object' }, { status: 400 });
  }
  if (error instanceof InvalidPaginationError) {
    return NextResponse.json({ error: 'Invalid pagination parameters' }, { status: 400 });
  }
  return null;
}
