import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/sites-auth/server';
import { Prisma } from '@/generated/prisma/client';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { goalDeadline, LEARNING_GOAL_DURATIONS, LEARNING_GOAL_TARGETS, pausedCalendarDays, shiftGoalDeadline, validGoalTimezone } from '@/lib/learning-goal-clock';
import { privateGoalView } from '@/lib/server/learning-goals';
import { readJsonObject, requestErrorResponse } from '@/lib/server/api-input';

export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store' };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: privateHeaders });

async function currentUserId() {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

function invalidBody(body: Record<string, unknown>, keys: string[]) {
  return Object.keys(body).some(key => !keys.includes(key));
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return reply({ error: 'Unauthorized' }, 401);
  try {
    const goal = await prisma.learningGoal.findUnique({ where: { userId } });
    return reply({ goal: goal ? await privateGoalView(prisma, goal) : null });
  } catch (error) {
    console.error('Failed to read private learning goal:', error);
    return reply({ error: 'Failed to read learning goal' }, 500);
  }
}

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return reply({ error: 'Unauthorized' }, 401);
  try {
    const body = await readJsonObject(request, 1024);
    if (invalidBody(body, ['targetLeaves', 'durationDays', 'timezone']) ||
        !LEARNING_GOAL_TARGETS.some(target => target === body.targetLeaves) ||
        !LEARNING_GOAL_DURATIONS.some(days => days === body.durationDays) ||
        !validGoalTimezone(body.timezone)) return reply({ error: 'Invalid learning goal' }, 400);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return reply({ error: 'User not found' }, 404);
    const now = new Date();
    const goal = await prisma.learningGoal.create({ data: {
      userId, targetLeaves: body.targetLeaves as number, durationDays: body.durationDays as number,
      timezone: body.timezone, startedAt: now, endsAt: goalDeadline(now, body.timezone, body.durationDays as number),
    } });
    return reply({ goal: await privateGoalView(prisma, goal, now) }, 201);
  } catch (error) {
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply({ error: 'A learning goal already exists' }, 409);
    console.error('Failed to start private learning goal:', error);
    return reply({ error: 'Failed to start learning goal' }, 500);
  }
}

export async function PATCH(request: Request) {
  const userId = await currentUserId();
  if (!userId) return reply({ error: 'Unauthorized' }, 401);
  try {
    const body = await readJsonObject(request, 1024);
    if (invalidBody(body, ['action']) || (body.action !== 'pause' && body.action !== 'resume')) return reply({ error: 'Invalid learning goal action' }, 400);
    const goal = await prisma.learningGoal.findUnique({ where: { userId } });
    if (!goal) return reply({ error: 'Learning goal not found' }, 404);
    const now = new Date();
    if (body.action === 'pause') {
      if (!goal.pausedAt) {
        if (now >= goal.endsAt) return reply({ error: 'This goal has ended. Remove it to start a new one.' }, 409);
        const changed = await prisma.learningGoal.updateMany({
          where: { userId, pausedAt: null, endsAt: goal.endsAt }, data: { pausedAt: now },
        });
        if (changed.count !== 1) return reply({ error: 'Learning goal changed; refresh and try again' }, 409);
      }
    } else if (goal.pausedAt) {
      const days = pausedCalendarDays(goal.pausedAt, now, goal.timezone);
      const changed = await prisma.learningGoal.updateMany({
        where: { userId, pausedAt: goal.pausedAt, endsAt: goal.endsAt },
        data: { pausedAt: null, endsAt: shiftGoalDeadline(goal.endsAt, goal.timezone, days) },
      });
      if (changed.count !== 1) return reply({ error: 'Learning goal changed; refresh and try again' }, 409);
    }
    const latest = await prisma.learningGoal.findUnique({ where: { userId } });
    return reply({ goal: latest ? await privateGoalView(prisma, latest, now) : null });
  } catch (error) {
    const inputError = requestErrorResponse(error);
    if (inputError) return inputError;
    console.error('Failed to change private learning goal:', error);
    return reply({ error: 'Failed to change learning goal' }, 500);
  }
}

export async function DELETE() {
  const userId = await currentUserId();
  if (!userId) return reply({ error: 'Unauthorized' }, 401);
  try {
    await prisma.learningGoal.deleteMany({ where: { userId } });
    return reply({ goal: null });
  } catch (error) {
    console.error('Failed to remove private learning goal:', error);
    return reply({ error: 'Failed to remove learning goal' }, 500);
  }
}
