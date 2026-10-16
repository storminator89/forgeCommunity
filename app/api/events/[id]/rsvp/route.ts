import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { ParticipationError } from '@/lib/server/participation';
import { EVENT_PARTICIPATION_HEADERS, joinEvent, leaveEvent, readEventParticipation } from '@/lib/server/event-participation';
import { requestErrorResponse } from '@/lib/server/api-input';
import { requestWithBodyLimit } from '@/lib/server/request-body';

type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: EVENT_PARTICIPATION_HEADERS });

async function currentUserId() {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

function failure(error: unknown) {
  if (error instanceof ParticipationError) return json({ error: error.message }, error.status);
  const input = requestErrorResponse(error);
  if (input) { input.headers.set('Cache-Control', EVENT_PARTICIPATION_HEADERS['Cache-Control']); return input; }
  console.error('Event RSVP failed:', error);
  return json({ error: 'Event RSVP failed' }, 500);
}

export async function GET(_request: Request, { params }: Context) {
  const userId = await currentUserId();
  if (!userId) return json({ error: 'Unauthorized' }, 401);
  try { return json(await readEventParticipation((await params).id, userId)); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request, { params }: Context) {
  const userId = await currentUserId();
  if (!userId) return json({ error: 'Unauthorized' }, 401);
  try {
    // Bodyless requests retain the old direct-registration/full-event contract.
    let allowWaitlist = false;
    const text = await (await requestWithBodyLimit(request, 1024)).text();
    if (text.length > 0) {
      let body: unknown;
      try { body = JSON.parse(text); } catch { throw new ParticipationError('Invalid JSON object', 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
          !('waitlist' in body) || typeof body.waitlist !== 'boolean') {
        throw new ParticipationError('Expected only a waitlist boolean', 400);
      }
      allowWaitlist = body.waitlist;
    }
    const result = await joinEvent((await params).id, userId, allowWaitlist);
    return json(result.state, result.created ? 201 : 200);
  } catch (error) { return failure(error); }
}

export async function DELETE(_request: Request, { params }: Context) {
  const userId = await currentUserId();
  if (!userId) return json({ error: 'Unauthorized' }, 401);
  try { return json(await leaveEvent((await params).id, userId)); }
  catch (error) { return failure(error); }
}
