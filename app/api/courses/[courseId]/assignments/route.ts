import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/app/api/auth/[...nextauth]/options'
import { AssignmentError, readAssignmentQueue } from '@/lib/server/course-assignments'

type Context = { params: Promise<{ courseId: string }> }

export async function GET(request: NextRequest, context: Context) {
  const headers = { 'Cache-Control': 'private, no-store' }
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  try {
    const { courseId } = await context.params
    const filter = request.nextUrl.searchParams.get('filter') ?? 'pending'
    if (filter !== 'pending' && filter !== 'all') return NextResponse.json({ error: 'Invalid filter' }, { status: 400, headers })
    return NextResponse.json(await readAssignmentQueue(courseId, session.user, request.nextUrl.searchParams.get('cursor'), filter), { headers })
  } catch (error) {
    if (error instanceof AssignmentError) return NextResponse.json({ error: error.message }, { status: error.status, headers })
    console.error('Failed to read assignment grading queue:', error)
    return NextResponse.json({ error: 'Failed to read grading queue' }, { status: 500, headers })
  }
}
