import 'server-only';
import { NextResponse } from 'next/server';
import { requestErrorResponse } from './api-input';
import { CourseLifecycleError } from './course-lifecycle';

export function courseErrorResponse(error: unknown) {
  if (error instanceof CourseLifecycleError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  const inputError = requestErrorResponse(error);
  if (inputError) return inputError;
  console.error('Course lifecycle request failed:', error);
  return NextResponse.json({ error: 'Course request failed' }, { status: 500 });
}
