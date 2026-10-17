import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';
import { NextResponse } from 'next/server';
import { requestErrorResponse } from '@/lib/server/api-input';
import { InvalidSpaceCursorError } from '@/lib/server/space-discussions';
import { SPACE_NO_STORE, SpaceApiError } from '@/lib/server/space-api';

const OPERATIONS = new Set([
  'invitation-preference.read', 'invitation-preference.update', 'invitation-candidates.search',
  'invitation.send', 'invitations.list', 'invitation.read', 'invitation.decide', 'invitation-targets.resolve',
]);
export type InvitationFailureOperation =
  | 'invitation-preference.read' | 'invitation-preference.update' | 'invitation-candidates.search'
  | 'invitation.send' | 'invitations.list' | 'invitation.read' | 'invitation.decide' | 'invitation-targets.resolve';
const PRISMA_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1003', 'P1008', 'P1017',
  'P2002', 'P2003', 'P2004', 'P2010', 'P2011', 'P2025', 'P2028', 'P2034']);
const ADAPTER_CODES = new Set(['40001', '40P01', 'P0001', 'SQLITE_BUSY', 'SQLITE_BUSY_RECOVERY',
  'SQLITE_BUSY_SNAPSHOT', 'SQLITE_BUSY_TIMEOUT', 'SQLITE_LOCKED', 'SQLITE_CONSTRAINT_CHECK',
  'SQLITE_CONSTRAINT_FOREIGNKEY', 'SQLITE_CONSTRAINT_TRIGGER', 'SQLITE_CONSTRAINT_UNIQUE',
  'SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_NOTNULL']);

/** No duck typing, error serialization, message, stack, metadata or arguments.
 * Technical codes are copied only from genuine installed runtime instances and
 * only when they exactly match this fixed allowlist. */
function technicalCode(error: unknown): string {
  try {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const code = error.code;
      return typeof code === 'string' && PRISMA_CODES.has(code) ? code : 'PRISMA_ERROR';
    }
    if (error instanceof DriverAdapterError) {
      const code = error.cause.originalCode;
      return typeof code === 'string' && ADAPTER_CODES.has(code) ? code : 'ADAPTER_ERROR';
    }
  } catch {
    // A hostile/exceptional accessor must neither bypass the allowlist nor
    // prevent the resolver from replacing the original private failure.
    return 'UNEXPECTED';
  }
  return 'UNEXPECTED';
}

export function reportInvitationFailure(operation: InvitationFailureOperation, error: unknown): void {
  console.error('SPACE_MISSION_INVITATION_FAILURE', {
    operation: OPERATIONS.has(operation) ? operation : 'invitation.unknown', code: technicalCode(error),
  });
}

/** Scoped to invitation handlers. Existing global logger behavior is unchanged. */
export function invitationErrorResponse(error: unknown, fallback: string, operation: InvitationFailureOperation) {
  if (error instanceof SpaceApiError) return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) },
    { status: error.status, headers: SPACE_NO_STORE });
  const input = requestErrorResponse(error);
  if (input) { input.headers.set('Cache-Control', SPACE_NO_STORE['Cache-Control']); return input; }
  if (error instanceof InvalidSpaceCursorError) return NextResponse.json({ error: 'Ungültiger Cursor' }, { status: 400, headers: SPACE_NO_STORE });
  reportInvitationFailure(operation, error);
  return NextResponse.json({ error: fallback }, { status: 500, headers: SPACE_NO_STORE });
}
