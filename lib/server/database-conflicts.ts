import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';

/** Preserve the real User.email conflict across Prisma 7's driver metadata,
 * without mistaking invitation-fence uniqueness or lookalike errors for it. */
export function isUserEmailConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  if (target === 'User_email_key' && (!error.meta?.modelName || error.meta.modelName === 'User')) return true;
  if (error.meta?.modelName === 'User' && Array.isArray(target) && target.length === 1 && target[0] === 'email') return true;
  const adapter = error.meta?.driverAdapterError;
  if (!(adapter instanceof DriverAdapterError) || adapter.cause.kind !== 'UniqueConstraintViolation' || adapter.cause.table !== 'User') return false;
  const constraint = adapter.cause.constraint;
  return Boolean(constraint && ('fields' in constraint && constraint.fields.length === 1 && constraint.fields[0] === 'email' ||
    'index' in constraint && constraint.index === 'User_email_key'));
}
