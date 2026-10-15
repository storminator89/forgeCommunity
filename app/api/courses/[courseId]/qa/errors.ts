import { NextResponse } from 'next/server';
import { requestErrorResponse } from '@/lib/server/api-input';
import { CourseQAError } from '@/lib/server/course-qa';

export const privateHeaders = { 'Cache-Control': 'private, no-store' };
export function qaFailure(error: unknown) {
  if (error instanceof CourseQAError) return NextResponse.json({ error: error.message }, { status: error.status, headers: privateHeaders });
  const input = requestErrorResponse(error);
  if (input) { input.headers.set('Cache-Control', 'private, no-store'); return input; }
  console.error('Course Q&A failed:', error);
  return NextResponse.json({ error: 'Kursfragen konnten nicht verarbeitet werden.' }, { status: 500, headers: privateHeaders });
}
