import { oauthProviderList } from '@/lib/sites-auth/oauth';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return oauthProviderList(request);
}
