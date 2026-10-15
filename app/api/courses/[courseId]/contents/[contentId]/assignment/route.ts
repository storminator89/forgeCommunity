import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/options'
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input'
import { AssignmentError, readOwnAssignment, submitAssignment } from '@/lib/server/course-assignments'
import { CoursePathError } from '@/lib/server/course-prerequisites'

type Context = { params: Promise<{ courseId: string; contentId: string }> }
const headers = { 'Cache-Control': 'private, no-store' }

function failure(error: unknown) {
  if (error instanceof AssignmentError) return NextResponse.json({ error: error.message }, { status: error.status, headers })
  if (error instanceof CoursePathError) return NextResponse.json({ error: error.message }, { status: error.status, headers })
  const input = requestErrorResponse(error)
  if (input) return input
  console.error('Assignment request failed:', error)
  return NextResponse.json({ error: 'Assignment request failed' }, { status: 500, headers })
}

export async function GET(_request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  try {
    const { courseId, contentId } = await context.params
    return NextResponse.json(await readOwnAssignment(courseId, contentId, session.user.id), { headers })
  } catch (error) { return failure(error) }
}

export async function POST(request: NextRequest, context: Context) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  try {
    const { courseId, contentId } = await context.params
    // Ten thousand UTF-16 code units can exceed 16 KiB when encoded as UTF-8.
    const body = await readJsonObject(request, 48 * 1024)
    return NextResponse.json(await submitAssignment(courseId, contentId, session.user.id, body), { status: 201, headers })
  } catch (error) { return failure(error) }
}
