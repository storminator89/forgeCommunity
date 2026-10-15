# Chat history and polling

The chat API uses a fixed 50-message keyset page. The default page selects the newest messages. `before` plus `beforeId` walks toward older messages; `after` plus `afterId` walks toward newer messages. Both directions order by `(createdAt, id)` so equal timestamps do not skip or repeat already-committed rows. Each page fetches at most 51 records to expose `hasMore`. Every direction repeats channel authorization before querying messages. The client offers explicit older-history loading and drains up to four forward pages per poll; further backlog is resumed on the next poll. History prepends preserve the reader's scroll position, and incoming messages only auto-follow near the bottom.

The live cursor is not a strict lossless-delivery guarantee across concurrent PostgreSQL commits. A message timestamp can be assigned before its notification transaction commits; if a later timestamp becomes visible first, a poll can advance past the delayed row. A future monotonic commit sequence or bounded overlapping reconciliation could close that edge. Neither is included in this focused change.

The channel list now selects only the fields used by the chat UI, avoiding every member's profile and an unused message count. For a synthetic 20-channel, 500-member-per-channel response with identical IDs, names, and counts, the JSON projection falls from 940,531 to 1,531 bytes. This is a payload-size comparison, not an HTTP or database latency measurement.

## Repeatable index probe

Run `python3 scripts/chat-query-benchmark.py`. It builds the same 200,000-message in-memory SQLite fixture for both phases, across 20 channels, then runs each query 40 times. Each phase returns identical row IDs. Results from 2026-10-15 in this workspace:

| Query | No index median / p95 | Composite index median / p95 |
| --- | ---: | ---: |
| Newest 51 | 14.124 / 19.069 ms | 0.016 / 0.023 ms |
| Next 51 | 11.960 / 16.784 ms | 0.479 / 0.702 ms |
| Previous 51 | 13.346 / 15.740 ms | 0.330 / 0.448 ms |

Without the index, SQLite reports a table scan and temporary B-tree sort. With `ChatMessage(channelId, createdAt, id)`, it reports a covering index search. These timings measure query execution on synthetic in-memory SQLite data, not production end-to-end latency or PostgreSQL performance.

Known separate management UX follow-up: an administrator can list an unjoined private channel, but the stricter message/history routes require membership. This change deliberately leaves that access boundary intact.
