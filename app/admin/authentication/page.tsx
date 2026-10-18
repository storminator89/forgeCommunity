import type { Metadata } from 'next';
import OAuthConfigurationForm from '@/components/admin/OAuthConfigurationForm';

export const metadata: Metadata = {
  title: 'Anmeldung & SSO | ForgeCommunity Administration',
  description: 'Google- und OpenID-Connect-Anmeldung für diese ForgeCommunity-Installation verwalten.',
  robots: { index: false, follow: false },
};

// Keep this page inside the existing /admin server layout. The installation's
// layout and both API methods must independently enforce a current ADMIN role.
// Do not import either installation's authentication implementation here.
export default function AuthenticationSettingsPage() {
  return <OAuthConfigurationForm />;
}
