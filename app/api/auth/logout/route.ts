import { endSession } from '@/lib/sites-auth/credentials';
import { isSameOriginRequest } from '@/lib/server/auth-security';
import { jsonError } from '@/lib/sites-auth/credentials';

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return jsonError('Ungültige Anfragequelle.', 403);
  return endSession(req.headers.get('cookie'), req.url);
}
