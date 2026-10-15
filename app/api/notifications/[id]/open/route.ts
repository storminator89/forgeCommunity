import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/prisma';
import { resolveNotificationTarget } from '@/lib/server/notification-target';

/** Resolve again at action time so a revoked/deleted destination is never opened. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });
    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return new NextResponse('Invalid notification', { status: 400 });
    const notification = await prisma.notification.findFirst({ where: { id, userId: session.user.id } });
    if (!notification) return new NextResponse('Notification not found', { status: 404 });
    const action = await resolveNotificationTarget(notification, session.user.id);
    if (!action) return new NextResponse('Destination unavailable', { status: 404 });
    const update = await prisma.notification.updateMany({ where: { id, userId: session.user.id }, data: { isRead: true } });
    if (update.count === 0) return new NextResponse('Notification not found', { status: 404 });
    return NextResponse.json(action, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[NOTIFICATIONS_OPEN]', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}
