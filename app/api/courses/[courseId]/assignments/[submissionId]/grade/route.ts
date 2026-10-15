import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/options'
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input'
import { AssignmentError, decideAssignmentGrade } from '@/lib/server/course-assignments'

type Context = { params: Promise<{ courseId: string; submissionId: string }> }

export async function POST(request: NextRequest, context: Context) {
  const headers = { 'Cache-Control': 'private, no-store' }
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  try {
    const { courseId, submissionId } = await context.params
    const body = await readJsonObject(request, 8 * 1024)
    return NextResponse.json(await decideAssignmentGrade(courseId, submissionId, session.user, body), { headers })
  } catch (error) {
    if (error instanceof AssignmentError) return NextResponse.json({ error: error.message }, { status: error.status, headers })
    const input = requestErrorResponse(error)
    if (input) return input
    console.error('Failed to grade assignment:', error)
    return NextResponse.json({ error: 'Failed to grade assignment' }, { status: 500, headers })
  }
}
