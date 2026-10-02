import type { CourseContent } from './types'

export function findContent(contents: CourseContent[], id: string): CourseContent | null {
  for (const content of contents) {
    if (content.id === id) return content
    const child = findContent(content.subContents || [], id)
    if (child) return child
  }
  return null
}

export function replaceContent(contents: CourseContent[], updated: CourseContent): CourseContent[] {
  return contents.map(content => content.id === updated.id
    ? { ...content, ...updated, subContents: updated.subContents ?? content.subContents }
    : { ...content, subContents: replaceContent(content.subContents || [], updated) })
}

export function appendContent(contents: CourseContent[], added: CourseContent): CourseContent[] {
  if (!added.parentId) return [...contents, added].sort((a, b) => a.order - b.order)
  return contents.map(content => content.id === added.parentId
    ? { ...content, subContents: [...(content.subContents || []), added].sort((a, b) => a.order - b.order) }
    : { ...content, subContents: appendContentToChildren(content.subContents || [], added) })
}

function appendContentToChildren(contents: CourseContent[], added: CourseContent): CourseContent[] {
  return contents.map(content => content.id === added.parentId
    ? { ...content, subContents: [...(content.subContents || []), added].sort((a, b) => a.order - b.order) }
    : { ...content, subContents: appendContentToChildren(content.subContents || [], added) })
}

export function removeContent(contents: CourseContent[], id: string): CourseContent[] {
  return contents.filter(content => content.id !== id).map(content => ({
    ...content, subContents: removeContent(content.subContents || [], id),
  }))
}

export function parentIds(contents: CourseContent[], id: string): string[] {
  const parents: string[] = []
  let content = findContent(contents, id)
  const seen = new Set<string>()
  while (content?.parentId && !seen.has(content.parentId)) {
    seen.add(content.parentId)
    parents.push(content.parentId)
    content = findContent(contents, content.parentId)
  }
  return parents
}

export function editableFields(content: CourseContent) {
  return { title: content.title, type: content.type, content: content.content }
}

/** Tiptap normalises an untouched empty text to <p></p>; it is still the same draft. */
export function editableSignature(content: CourseContent): string {
  const fields = editableFields(content)
  if (fields.type === 'TEXT' && typeof fields.content === 'string'
    && !fields.content.replace(/<(?:\/?p|br)\b[^>]*>/gi, '').replace(/&nbsp;|\u00a0/g, ' ').trim()) {
    fields.content = ''
  }
  return JSON.stringify(fields)
}
