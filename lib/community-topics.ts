export const MAX_POST_TOPICS = 3
export const MAX_TOPIC_LENGTH = 48

// Keep names readable across articles, projects and discussions. React escapes
// them on display; the server rejects control characters and markup at input.
export const TOPIC_NAME_PATTERN = new RegExp('^[\\p{L}\\p{N}][\\p{L}\\p{N} .+#/_-]*$', 'u')

export class InvalidTopicError extends Error {}

export function normalizeTopicName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ')
}

export function validTopicName(value: string): boolean {
  return value.length > 0 && value.length <= MAX_TOPIC_LENGTH && TOPIC_NAME_PATTERN.test(value)
}

export function parsePostTopics(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_POST_TOPICS) return null
  const topics: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') return null
    const name = normalizeTopicName(item)
    if (!validTopicName(name)) return null
    const key = name.toLowerCase()
    if (seen.has(key)) return null
    seen.add(key)
    topics.push(name)
  }
  return topics
}

export function readTopicFilter(request: Request): string | null {
  const params = new URL(request.url).searchParams
  const values = params.getAll('tag')
  if (values.length === 0) return null
  if (values.length !== 1 || !validTopicName(values[0]) || normalizeTopicName(values[0]) !== values[0]) {
    throw new InvalidTopicError('Ungültiges Thema')
  }
  return values[0]
}
