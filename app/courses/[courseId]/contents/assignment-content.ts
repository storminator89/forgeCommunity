/** Plain-text assignment prompts and answers; files and HTML are intentionally out of scope. */
export interface AssignmentContent { prompt: string; passingScore: number }
export const EMPTY_ASSIGNMENT: AssignmentContent = { prompt: '', passingScore: 70 }
export const MAX_ASSIGNMENT_PROMPT = 10_000
export const MAX_ASSIGNMENT_RESPONSE = 10_000
export const MAX_ASSIGNMENT_FEEDBACK = 2_000

export function parseAssignmentContent(value: unknown): AssignmentContent | null {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) as unknown } catch { return null }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (Object.keys(source).some(key => !['prompt', 'passingScore'].includes(key)) ||
      typeof source.prompt !== 'string' || source.prompt.length > MAX_ASSIGNMENT_PROMPT ||
      !Number.isInteger(source.passingScore) || Number(source.passingScore) < 1 || Number(source.passingScore) > 100) return null
  return { prompt: source.prompt, passingScore: source.passingScore as number }
}

export function getAssignmentValidationError(value: unknown): string | null {
  const assignment = parseAssignmentContent(value)
  if (!assignment) return 'Gib eine gültige Aufgabe und eine Bestehensgrenze zwischen 1 und 100 % ein.'
  if (!assignment.prompt.trim()) return 'Der Aufgabentext fehlt.'
  return null
}
