import type { ReactNode } from 'react';
import { getServerSession } from '@/lib/sites-auth/server';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export default async function ModerationLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (actor?.role !== 'ADMIN' && actor?.role !== 'MODERATOR') redirect('/');
  return children;
}
