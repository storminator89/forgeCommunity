import { NextResponse } from 'next/server';
import { requestErrorResponse } from '@/lib/server/api-input';
import { PracticeError } from '@/lib/server/formative-practice';

export const practicePrivateHeaders = { 'Cache-Control': 'private, no-store' };
export function practiceFailure(error: unknown) {
  if (error instanceof PracticeError) return NextResponse.json({ error: error.message }, { status: error.status, headers: practicePrivateHeaders });
  const inputError = requestErrorResponse(error);
  if (inputError) return inputError;
  console.error('Formative practice authoring failed:', error);
  return NextResponse.json({ error: 'Übung konnte nicht verarbeitet werden.' }, { status: 500, headers: practicePrivateHeaders });
}
export function practiceUnauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: practicePrivateHeaders });
}
