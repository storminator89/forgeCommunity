import { completeOAuth } from '@/lib/sites-auth/oauth';

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  return completeOAuth(request, (await params).provider);
}
