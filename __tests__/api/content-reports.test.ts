import { GET as getReports, POST as createReport } from '@/app/api/reports/route';
import { PATCH as reviewReport } from '@/app/api/reports/[reportId]/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) },
}));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    contentReport: { findUnique: jest.fn(), create: jest.fn(), count: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    post: { findUnique: jest.fn(), findMany: jest.fn() },
    comment: { findUnique: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const reports = prisma.contentReport as jest.Mocked<typeof prisma.contentReport>;
const posts = prisma.post as jest.Mocked<typeof prisma.post>;
const comments = prisma.comment as jest.Mocked<typeof prisma.comment>;
const users = prisma.user as jest.Mocked<typeof prisma.user>;

function request(body?: Record<string, unknown>, url = 'http://localhost/api/reports', origin?: string) {
  return {
    url,
    headers: { get: (name: string) => name === 'origin' ? origin ?? null : null },
    body: null,
    json: async () => body,
  } as never;
}

const validPost = { targetType: 'POST', targetId: 'post-1', reason: 'SPAM', details: 'Repetitive links' };
const validComment = { targetType: 'COMMENT', targetId: 'comment-1', reason: 'HARASSMENT' };

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.$transaction as jest.Mock).mockImplementation(async work => work(prisma));
  (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'reporter-1', role: 'USER' } });
  (reports.findUnique as jest.Mock).mockResolvedValue(null);
  (reports.count as jest.Mock).mockResolvedValue(0);
  (reports.create as jest.Mock).mockResolvedValue({ id: 'report-1' });
  (posts.findUnique as jest.Mock).mockResolvedValue({ authorId: 'author-1', published: true });
  (comments.findUnique as jest.Mock).mockResolvedValue({ authorId: 'author-1', post: { published: true } });
});

describe('member reporting', () => {
  it('requires authentication and ignores body-supplied reporter identity', async () => {
    (getServerSession as jest.Mock).mockResolvedValueOnce(null);
    expect((await createReport(request(validPost))).status).toBe(401);
    expect(reports.findUnique).not.toHaveBeenCalled();

    const response = await createReport(request({ ...validPost, reporterId: 'someone-else', status: 'RESOLVED' }));
    expect(response.status).toBe(201);
    expect(reports.create).toHaveBeenCalledWith({
      data: { reporterId: 'reporter-1', targetType: 'POST', targetId: 'post-1', reason: 'SPAM', details: 'Repetitive links' },
      select: { id: true },
    });
  });

  it('rejects cross-origin browser submissions', async () => {
    expect((await createReport(request(validPost, 'http://localhost/api/reports', 'https://attacker.invalid'))).status).toBe(403);
    expect(reports.create).not.toHaveBeenCalled();
  });

  it('rejects invalid reasons, identifiers and free-text overflow', async () => {
    for (const body of [
      { ...validPost, reason: 'MADE_UP' },
      { ...validPost, targetId: '../private' },
      { ...validPost, details: 'x'.repeat(501) },
      { ...validPost, reason: 'OTHER', details: 'no' },
    ]) {
      expect((await createReport(request(body))).status).toBe(400);
    }
    expect(posts.findUnique).not.toHaveBeenCalled();
  });

  it('rejects self reports and unavailable post or comment targets', async () => {
    (posts.findUnique as jest.Mock).mockResolvedValueOnce({ authorId: 'reporter-1', published: true });
    expect((await createReport(request(validPost))).status).toBe(400);
    (posts.findUnique as jest.Mock).mockResolvedValueOnce({ authorId: 'author-1', published: false });
    expect((await createReport(request(validPost))).status).toBe(404);
    (posts.findUnique as jest.Mock).mockResolvedValueOnce(null);
    expect((await createReport(request(validPost))).status).toBe(404);

    (comments.findUnique as jest.Mock).mockResolvedValueOnce({ authorId: 'author-1', post: { published: false } });
    expect((await createReport(request(validComment))).status).toBe(404);
    (comments.findUnique as jest.Mock).mockResolvedValueOnce({ authorId: 'reporter-1', post: { published: true } });
    expect((await createReport(request(validComment))).status).toBe(400);
    expect(reports.create).not.toHaveBeenCalled();
  });

  it('returns an existing report idempotently, even after review or target deletion', async () => {
    (reports.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'already-reviewed' });
    const response = await createReport(request(validPost));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'already-reviewed', alreadyReported: true });
    expect(posts.findUnique).not.toHaveBeenCalled();
    expect(reports.count).not.toHaveBeenCalled();
    expect(reports.create).not.toHaveBeenCalled();
  });

  it('caps newly created reports and handles a concurrent duplicate', async () => {
    (reports.count as jest.Mock).mockResolvedValueOnce(5);
    expect((await createReport(request(validPost))).status).toBe(429);
    expect(reports.create).not.toHaveBeenCalled();

    (reports.count as jest.Mock).mockResolvedValueOnce(0);
    (reports.create as jest.Mock).mockRejectedValueOnce({ code: 'P2002' });
    (reports.findUnique as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'race-winner' });
    const response = await createReport(request(validPost));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'race-winner', alreadyReported: true });
  });
});

describe('moderator queue and review', () => {
  const pageUrl = 'http://localhost/api/reports?status=OPEN&page=1';

  it('rejects ordinary members from queue reads and decisions', async () => {
    (users.findUnique as jest.Mock).mockResolvedValue({ role: 'USER' });
    expect((await getReports(request(undefined, pageUrl))).status).toBe(403);
    expect((await reviewReport(request({ status: 'DISMISSED', resolutionNote: 'No issue found' }),
      { params: Promise.resolve({ reportId: 'report-1' }) })).status).toBe(403);
    expect(reports.findMany).not.toHaveBeenCalled();
    expect(reports.updateMany).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'MODERATOR'])('rejects a stale %s session according to the current database role', async (role) => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'reporter-1', role } });
    (users.findUnique as jest.Mock).mockResolvedValue({ role: 'USER' });

    expect((await getReports(request(undefined, pageUrl))).status).toBe(403);
    expect((await reviewReport(request({ status: 'DISMISSED', resolutionNote: 'No issue found' }),
      { params: Promise.resolve({ reportId: 'report-1' }) })).status).toBe(403);
    expect(users.findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: 'reporter-1' }, select: { role: true },
    });
    expect(users.findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 'reporter-1' }, select: { role: true },
    });
    expect(reports.findMany).not.toHaveBeenCalled();
    expect(reports.updateMany).not.toHaveBeenCalled();
  });

  it('returns only current public target previews and never reporter identity', async () => {
    (users.findUnique as jest.Mock).mockResolvedValue({ role: 'MODERATOR' });
    (reports.findMany as jest.Mock).mockResolvedValue([
      { id: 'r1', reporterId: 'secret-reporter', targetType: 'POST', targetId: 'post-1', reason: 'SPAM',
        details: null, status: 'OPEN', createdAt: new Date(), reviewedAt: null, reviewedById: null, resolutionNote: null },
      { id: 'r2', reporterId: 'other-secret', targetType: 'COMMENT', targetId: 'deleted-1', reason: 'UNSAFE',
        details: null, status: 'OPEN', createdAt: new Date(), reviewedAt: null, reviewedById: null, resolutionNote: null },
    ]);
    (reports.count as jest.Mock).mockResolvedValue(2);
    (posts.findMany as jest.Mock).mockResolvedValue([{ id: 'post-1', title: 'Public post', content: '<p>Public text</p>' }]);
    (comments.findMany as jest.Mock).mockResolvedValue([]);

    const response = await getReports(request(undefined, pageUrl));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(reports.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
    }));
    expect(posts.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['post-1'] }, published: true }, select: { id: true, title: true, content: true },
    });
    expect(comments.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['deleted-1'] }, post: { published: true } }, select: { id: true, content: true },
    });
    expect(body.items[0]).toMatchObject({ targetAvailable: true, targetTitle: 'Public post', targetPreview: 'Public text' });
    expect(body.items[1]).toMatchObject({ targetAvailable: false, targetTitle: null, targetPreview: null });
    expect(JSON.stringify(body)).not.toContain('secret-reporter');
    expect(JSON.stringify(body)).not.toContain('other-secret');
  });

  it('accepts a moderator decision once and preserves its reviewer/time on retries', async () => {
    (users.findUnique as jest.Mock).mockResolvedValue({ role: 'MODERATOR' });
    (reports.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    (reports.findUnique as jest.Mock).mockResolvedValue({ id: 'report-1' });
    const body = { status: 'RESOLVED', resolutionNote: 'Removed by an admin', actionTaken: true,
      reviewedById: 'spoofed', reviewedAt: '2000-01-01' };
    const first = await reviewReport(request(body), { params: Promise.resolve({ reportId: 'report-1' }) });
    expect(first.status).toBe(200);
    expect(reports.updateMany).toHaveBeenCalledWith({
      where: { id: 'report-1', status: 'OPEN' },
      data: { status: 'RESOLVED', resolutionNote: 'Removed by an admin', reviewedById: 'reporter-1', reviewedAt: expect.any(Date) },
    });
    const second = await reviewReport(request(body), { params: Promise.resolve({ reportId: 'report-1' }) });
    expect(second.status).toBe(409);
    expect(reports.updateMany).toHaveBeenCalledTimes(2);
  });

  it('requires explicit completed-action confirmation for resolved status', async () => {
    (users.findUnique as jest.Mock).mockResolvedValue({ role: 'ADMIN' });
    const response = await reviewReport(request({ status: 'RESOLVED', resolutionNote: 'I reviewed this' }),
      { params: Promise.resolve({ reportId: 'report-1' }) });
    expect(response.status).toBe(400);
    expect(reports.updateMany).not.toHaveBeenCalled();
  });

  it('lets staff dismiss a report with a note and distinguishes a missing report', async () => {
    (users.findUnique as jest.Mock).mockResolvedValue({ role: 'ADMIN' });
    (reports.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const dismissed = await reviewReport(request({ status: 'DISMISSED', resolutionNote: 'No violation found' }),
      { params: Promise.resolve({ reportId: 'report-1' }) });
    expect(dismissed.status).toBe(200);
    expect(reports.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'DISMISSED', reviewedById: 'reporter-1' }),
    }));
    expect((await reviewReport(request({ status: 'DISMISSED', resolutionNote: 'No violation found' }),
      { params: Promise.resolve({ reportId: 'missing-1' }) })).status).toBe(404);
  });

  it('returns resolved audit fields to staff without returning a reporter id', async () => {
    (users.findUnique as jest.Mock).mockResolvedValue({ role: 'ADMIN' });
    (reports.findMany as jest.Mock).mockResolvedValue([{
      id: 'r1', reporterId: 'private-reporter', targetType: 'POST', targetId: 'deleted-post', reason: 'SPAM',
      details: null, status: 'RESOLVED', createdAt: new Date('2026-10-01'),
      reviewedAt: new Date('2026-10-02'), reviewedById: 'admin-1', resolutionNote: 'Admin removed the post',
    }]);
    (reports.count as jest.Mock).mockResolvedValue(1);
    (posts.findMany as jest.Mock).mockResolvedValue([]);
    const response = await getReports(request(undefined, 'http://localhost/api/reports?status=RESOLVED&page=1'));
    const body = await response.json();
    expect(body.items[0]).toMatchObject({
      status: 'RESOLVED', reviewedById: 'admin-1', resolutionNote: 'Admin removed the post',
      targetAvailable: false, targetPreview: null,
    });
    expect(JSON.stringify(body)).not.toContain('private-reporter');
  });

  it('rejects a cross-origin review attempt', async () => {
    (users.findUnique as jest.Mock).mockResolvedValue({ role: 'MODERATOR' });
    const response = await reviewReport(request({ status: 'DISMISSED', resolutionNote: 'No violation found' },
      'http://localhost/api/reports/report-1', 'https://attacker.invalid'),
    { params: Promise.resolve({ reportId: 'report-1' }) });
    expect(response.status).toBe(403);
    expect(reports.updateMany).not.toHaveBeenCalled();
  });
});
