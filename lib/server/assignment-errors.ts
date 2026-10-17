import 'server-only'

/** One identity shared by the D1 service and the existing HTTP boundary. */
export class AssignmentError extends Error {
  constructor(message: string, public readonly status = 400) { super(message) }
}
