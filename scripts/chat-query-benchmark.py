#!/usr/bin/env python3
"""Repeatable SQLite chat keyset-query benchmark; no production data needed."""
import sqlite3
import statistics
import time
import json

ROWS = 200_000
RUNS = 40
connection = sqlite3.connect(':memory:')
connection.execute('CREATE TABLE "ChatMessage" ("id" TEXT PRIMARY KEY, "channelId" TEXT, "createdAt" TEXT)')
connection.executemany(
    'INSERT INTO "ChatMessage" VALUES (?, ?, ?)',
    (
        (
            f'{i:08d}',
            f'ch-{i % 20}',
            f'2026-10-{1 + i // 20000:02d}T{(i // 3600) % 24:02d}:{(i // 60) % 60:02d}:{i % 60:02d}.000Z',
        )
        for i in range(ROWS)
    ),
)
connection.commit()

cursor_time = '2026-10-06T12:00:00.000Z'
queries = {
    'latest': (
        'SELECT id FROM "ChatMessage" WHERE "channelId"=? ORDER BY "createdAt" DESC, "id" DESC LIMIT 51',
        ('ch-0',),
    ),
    'after': (
        'SELECT id FROM "ChatMessage" WHERE "channelId"=? AND ("createdAt">? OR ("createdAt"=? AND "id">?)) ORDER BY "createdAt" ASC, "id" ASC LIMIT 51',
        ('ch-0', cursor_time, cursor_time, '00110000'),
    ),
    'before': (
        'SELECT id FROM "ChatMessage" WHERE "channelId"=? AND ("createdAt"<? OR ("createdAt"=? AND "id"<?)) ORDER BY "createdAt" DESC, "id" DESC LIMIT 51',
        ('ch-0', cursor_time, cursor_time, '00110000'),
    ),
}

baseline_results = {}
for phase in ('baseline', 'indexed'):
    if phase == 'indexed':
        connection.execute('CREATE INDEX "ChatMessage_channelId_createdAt_id_idx" ON "ChatMessage"("channelId", "createdAt", "id")')
    for name, (sql, parameters) in queries.items():
        plan = connection.execute('EXPLAIN QUERY PLAN ' + sql, parameters).fetchall()
        timings = []
        for _ in range(RUNS):
            start = time.perf_counter()
            result = [row[0] for row in connection.execute(sql, parameters)]
            timings.append((time.perf_counter() - start) * 1000)
        if phase == 'baseline':
            baseline_results[name] = result
        else:
            assert result == baseline_results[name], f'{name} result changed with the index'
        print(f'{phase:8s} {name:6s} median={statistics.median(timings):.3f}ms p95={sorted(timings)[int(RUNS * .95) - 1]:.3f}ms count={len(result)} plan={plan}')

channels_before = [
    {
        'id': f'ch-{channel}', 'name': f'Channel {channel}', 'isPrivate': channel % 2 == 0,
        'members': [
            {'id': f'membership-{channel}-{member}', 'user': {
                'id': f'u{member}', 'name': f'Member {member}', 'image': None, 'role': 'USER',
            }}
            for member in range(500)
        ],
        '_count': {'messages': 100_000, 'members': 500},
    }
    for channel in range(20)
]
channels_after = [
    {'id': channel['id'], 'name': channel['name'], 'isPrivate': channel['isPrivate'],
     '_count': {'members': channel['_count']['members']}}
    for channel in channels_before
]
def json_size(value):
    return len(json.dumps(value, separators=(',', ':')).encode('utf8'))
print(f'channel payload (20 x 500 members): before={json_size(channels_before)} bytes after={json_size(channels_after)} bytes')
