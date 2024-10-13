import { Metadata } from 'next';
import UserManagement from '@/components/admin/UserManagement';

export const metadata: Metadata = {
  title: 'Benutzerverwaltung | Admin Dashboard',
  description: 'Verwalten Sie Benutzer und deren Rollen in der ForgeCommunity-Plattform.',
};

export default function UserManagementPage() {
  return <UserManagement />;
}