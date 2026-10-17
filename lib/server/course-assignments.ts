import 'server-only'

import { AssignmentError } from '@/lib/server/assignment-errors'
import { CoursePathError } from '@/lib/server/course-path'
import { d1ReadOwnAssignment, d1ReadAssignmentQueue } from '@/lib/server/d1-course-assignment-reads'
import { d1SubmitAssignment, d1DecideAssignmentGrade } from '@/lib/server/d1-course-assignment-writes'

export { AssignmentError } from '@/lib/server/assignment-errors'

type Actor = { id: string; role?: string | null }

// Preserve the route's established assignment-error contract, including the
// queue/grade boundaries that do not handle CoursePathError themselves.
async function assignmentOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation() }
  catch (error) {
    if (error instanceof CoursePathError) throw new AssignmentError(error.message, error.status)
    throw error
  }
}

export async function readOwnAssignment(courseId: string, contentId: string, userId: string) {
  return assignmentOperation(() => d1ReadOwnAssignment(courseId, contentId, userId))
}

export async function submitAssignment(courseId: string, contentId: string, userId: string, body: Record<string, unknown>) {
  return assignmentOperation(() => d1SubmitAssignment(courseId, contentId, userId, body))
}

export async function readAssignmentQueue(courseId: string, actor: Actor, cursor?: string | null, filter: 'pending' | 'all' = 'pending') {
  return assignmentOperation(() => d1ReadAssignmentQueue(courseId, actor, cursor, filter))
}

export async function decideAssignmentGrade(courseId: string, submissionId: string, actor: Actor, body: Record<string, unknown>) {
  return assignmentOperation(() => d1DecideAssignmentGrade(courseId, submissionId, actor, body))
}
