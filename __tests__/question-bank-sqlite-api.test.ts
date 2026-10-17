/** @jest-environment node */
import { rmSync } from 'node:fs';
import { GET as listQuestions, POST as createQuestion } from '@/app/api/courses/questions/route';
import { GET as questionHistory, PATCH as reviseQuestion } from '@/app/api/courses/questions/[questionId]/route';
import { GET as questionRevision } from '@/app/api/courses/questions/[questionId]/revisions/[revision]/route';
import prisma from '@/lib/prisma';
import { getServerSession } from '@/lib/sites-auth/server';

jest.mock('next/server', () => ({
  NextResponse: class extends Response {
    static json(value: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(value), { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    }
  },
}));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-bank-api-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const name of readdirSync(join(process.cwd(), 'prisma', 'sqlite-migrations')).filter((name: string) => name.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(process.cwd(), 'prisma', 'sqlite-migrations', name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, __tempDirectory: directory,
    default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const question = { id: 'in-course', type: 'SINGLE_CHOICE', question: 'Which answer?',
  options: ['No', 'Yes'], correctAnswers: [1], explanation: 'Private explanation' };
const url = 'http://localhost/api/courses/questions';
const request = (method = 'GET', body?: object) => new Request(url, { method,
  ...(body && { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) }) as never;
const itemRequest = (id: string, method = 'GET', body?: object) => new Request(`${url}/${id}`, { method,
  ...(body && { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) }) as never;
const itemContext = (questionId: string) => ({ params: Promise.resolve({ questionId }) });
const versionContext = (questionId: string, revision: string) => ({ params: Promise.resolve({ questionId, revision }) });

function actor(id?: string) {
  jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role: 'USER' } } as never : null);
}

beforeAll(async () => {
  await prisma.user.create({ data: { id: 'bank-author', email: 'bank-author@example.invalid', role: 'USER' } });
  await prisma.user.create({ data: { id: 'bank-other', email: 'bank-other@example.invalid', role: 'ADMIN' } });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

test('current ordinary account can create; anonymous and missing accounts cannot', async () => {
  actor();
  expect((await createQuestion(request('POST', { question }))).status).toBe(401);
  actor('missing-account');
  expect((await createQuestion(request('POST', { question }))).status).toBe(403);
  actor('bank-author');
  const created = await createQuestion(request('POST', { question: { ...question, unknownSecret: 'strip-me' } }));
  expect(created.status).toBe(201);
  expect(created.headers.get('cache-control')).toBe('private, no-store');
  expect((await prisma.questionBankItem.count({ where: { ownerId: 'bank-author' } })).valueOf()).toBe(1);
  const stored = await prisma.questionBankRevision.findFirstOrThrow();
  expect(stored.questionJson).not.toContain('unknownSecret');
});

test('list is key-free; other-author ID probing reveals no question or answer key', async () => {
  actor('bank-author');
  const listed = await listQuestions(request());
  const body = await listed.json();
  const id = body.questions[0].id;
  expect(JSON.stringify(body)).not.toContain('correctAnswers');
  expect(JSON.stringify(body)).not.toContain('Private explanation');
  actor('bank-other');
  expect((await listQuestions(request())).json()).resolves.toEqual({ questions: [], nextCursor: null });
  const deniedHistory = await questionHistory(itemRequest(id), itemContext(id));
  const deniedRevision = await questionRevision(itemRequest(id), versionContext(id, '1'));
  const deniedEdit = await reviseQuestion(itemRequest(id, 'PATCH', { expectedRevision: 1, question }), itemContext(id));
  expect([deniedHistory.status, deniedRevision.status, deniedEdit.status]).toEqual([404, 404, 404]);
  for (const response of [deniedHistory, deniedRevision, deniedEdit]) {
    expect(await response.text()).not.toContain('correctAnswers');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  }
});

test('CAS revises once, retains immutable old key and rejects stale edit', async () => {
  actor('bank-author');
  const { questions: [item] } = await (await listQuestions(request())).json();
  const newer = { ...question, options: ['No', 'Changed'], correctAnswers: [0] };
  const changed = await reviseQuestion(itemRequest(item.id, 'PATCH', { expectedRevision: 1, question: newer }), itemContext(item.id));
  expect(changed.status).toBe(200);
  expect((await changed.json()).latestRevision).toBe(2);
  const stale = await reviseQuestion(itemRequest(item.id, 'PATCH', { expectedRevision: 1, question }), itemContext(item.id));
  expect(stale.status).toBe(409);
  const old = await questionRevision(itemRequest(item.id), versionContext(item.id, '1'));
  const latest = await questionRevision(itemRequest(item.id), versionContext(item.id, '2'));
  expect((await old.json()).question).toMatchObject({ options: ['No', 'Yes'], correctAnswers: [1] });
  expect((await latest.json()).question).toMatchObject({ options: ['No', 'Changed'], correctAnswers: [0] });
  expect(await prisma.questionBankRevision.count({ where: { itemId: item.id } })).toBe(2);
});

test('two edits from the same version cannot overwrite each other', async () => {
  actor('bank-author');
  const { questions: [item] } = await (await listQuestions(request())).json();
  const responses = await Promise.all([
    reviseQuestion(itemRequest(item.id, 'PATCH', { expectedRevision: 2, question }), itemContext(item.id)),
    reviseQuestion(itemRequest(item.id, 'PATCH', { expectedRevision: 2, question: { ...question, question: 'Concurrent edit' } }), itemContext(item.id)),
  ]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  expect(await prisma.questionBankRevision.count({ where: { itemId: item.id } })).toBe(3);
  expect((await prisma.questionBankItem.findUniqueOrThrow({ where: { id: item.id } })).latestRevision).toBe(3);
});

test('invalid questions and missing revisions leave existing rows intact', async () => {
  actor('bank-author');
  const { questions: [item] } = await (await listQuestions(request())).json();
  expect((await createQuestion(request('POST', { question: { ...question, correctAnswers: [] } }))).status).toBe(400);
  expect((await reviseQuestion(itemRequest(item.id, 'PATCH', { expectedRevision: 3, question: { ...question, options: [] } }), itemContext(item.id))).status).toBe(400);
  expect((await questionRevision(itemRequest(item.id), versionContext(item.id, '999'))).status).toBe(404);
  expect(await prisma.questionBankRevision.count({ where: { itemId: item.id } })).toBe(3);
});
