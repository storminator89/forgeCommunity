import { NextResponse } from 'next/server';
import { requestErrorResponse } from '@/lib/server/api-input';
import { AuthoringError } from '@/lib/server/course-authoring';
import { CourseAssetError } from '@/lib/server/course-assets';
import { H5PValidationError } from '@/lib/server/h5p-archive';
import { ContentMutationError } from '@/app/api/courses/[courseId]/contents/content-mutations';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

export function authoringFailure(error: unknown) {
  if (error instanceof AuthoringError || error instanceof CourseAssetError || error instanceof H5PValidationError || error instanceof ContentMutationError) {
    return NextResponse.json({ error: error.message, ...(error instanceof AuthoringError && error.code ? { code: error.code } : {}) }, { status: error.status, headers: privateHeaders });
  }
  const inputError = requestErrorResponse(error);
  if (inputError) return inputError;
  console.error('Course authoring failed:', error);
  return NextResponse.json({ error: 'Kursentwurf konnte nicht verarbeitet werden.' }, { status: 500, headers: privateHeaders });
}
