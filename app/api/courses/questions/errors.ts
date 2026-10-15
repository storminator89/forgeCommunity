import { NextResponse } from 'next/server';
import { requestErrorResponse } from '@/lib/server/api-input';
import { QuestionBankError } from '@/lib/server/question-bank';

export const privateBankHeaders = { 'Cache-Control': 'private, no-store' };

export function questionBankFailure(error: unknown) {
  if (error instanceof QuestionBankError) return NextResponse.json({ error: error.message },
    { status: error.status, headers: privateBankHeaders });
  const input = requestErrorResponse(error);
  if (input) {
    input.headers.set('Cache-Control', 'private, no-store');
    return input;
  }
  console.error('Question bank request failed:', error);
  return NextResponse.json({ error: 'Fragenpool konnte nicht verarbeitet werden.' },
    { status: 500, headers: privateBankHeaders });
}
