import { beginOAuth } from '@/lib/sites-auth/oauth';

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  return beginOAuth(request, (await params).provider);
}
