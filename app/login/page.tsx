import { AuthForm } from '@/components/auth-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams;
  return <AuthForm mode="login" callbackUrl={callbackUrl} />;
}
