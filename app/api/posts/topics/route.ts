import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { MAX_TOPIC_LENGTH } from '@/lib/community-topics'

// A topic is discoverable only after it appears on a published discussion.
// This must never reveal names used solely on private drafts or other resources.
export async function GET(request: NextRequest) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (query.length > MAX_TOPIC_LENGTH) {
    return NextResponse.json({ error: 'Suchbegriff ist zu lang' }, { status: 400 })
  }
  try {
    // SQLite's LIKE is case-insensitive for ASCII, while PostgreSQL's LIKE is
    // not. Cover common capitalization without relying on provider-specific SQL.
    const lower = query.toLowerCase()
    const variants = [...new Set([query, lower, query.toUpperCase(), lower.charAt(0).toUpperCase() + lower.slice(1)])]
    const topics = await prisma.tag.findMany({
      where: { posts: { some: { published: true } }, ...(query ? { OR: variants.map(value => ({ name: { contains: value } })) } : {}) },
      orderBy: { name: 'asc' },
      take: 30,
      select: { id: true, name: true },
    })
    return NextResponse.json({ topics }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('Fehler beim Abrufen der Themen:', error)
    return NextResponse.json({ error: 'Themen konnten nicht geladen werden' }, { status: 500 })
  }
}
