import { NextResponse } from 'next/server';
import { env } from 'cloudflare:workers';
import { getServerSession } from '@/lib/sites-auth/server';
import { authOptions } from '@/lib/auth';
import { getChatImage, parseChatImageFilename } from '@/lib/server/chat-image-r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE_HEADERS });
const unauthorized = () => NextResponse.json(
  { error: 'Nicht autorisiert.', errorCode: 'UNAUTHORIZED' }, { status: 401, headers: PRIVATE_HEADERS },
);

export async function GET(
  _request: Request,
  props: { params: Promise<{ filename: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return unauthorized();

    const { filename } = await props.params;
    const parsed = parseChatImageFilename(filename);
    if (!parsed) return notFound();
    if (!env.DB) throw new Error('Chat database is unavailable.');

    // One current primary statement checks account existence and authority.
    // Owners may preview their orphan upload. Everyone else needs an exact
    // current message and readable current channel; ADMIN has no bypass.
    const access = await env.DB.withSession('first-primary').prepare(`
      SELECT viewer.id AS viewerId, (
        viewer.id = ?2 OR EXISTS (
          SELECT 1 FROM ChatMessage message
          JOIN ChatChannel channel ON channel.id = message.channelId
          WHERE message.imageUrl = ?3 AND message.authorId = ?2
            AND (channel.isPrivate = 0 OR EXISTS (
              SELECT 1 FROM ChatMember member
              WHERE member.channelId = channel.id AND member.userId = viewer.id
            ))
        )
      ) AS authorized
      FROM User viewer WHERE viewer.id = ?1
    `).bind(session.user.id, parsed.ownerId, `/api/chat/uploads/${filename}`)
      .first<{ viewerId: string; authorized: number }>();
    if (!access) return unauthorized();
    if (access.authorized !== 1) return notFound();

    // Authorization precedes even BUCKET.get. Do not forward object-controlled
    // HTTP headers or materialize the image into an application byte buffer.
    const object = await getChatImage(parsed.key, parsed.ownerId);
    if (!object) return notFound();
    return new NextResponse(object.body as unknown as ReadableStream<Uint8Array>, {
      headers: { ...PRIVATE_HEADERS, 'Content-Type': 'image/png', 'Content-Length': String(object.size) },
    });
  } catch {
    return notFound();
  }
}
