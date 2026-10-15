# Actionable in-app notifications

The in-app inbox polls the authenticated user's notifications. The SSE endpoint remains unavailable (501); no email sender, server push provider, digest, or mute engine is connected. Settings describe the email option as a future preference and browser alerts as local desktop hints for chat. These settings do not gate in-app notifications.

Server domain events attach a typed object ID rather than a URL:

- Following a member creates a `FOLLOW` notification for that member, pointing to the follower's profile.
- Replying to a post creates a `COMMENT` notification for its author, pointing to the exact comment. Self-replies do not notify. The existing linked-comment endpoint retrieves comments beyond the first feed page or comment preview.
- A new chat message notifies only other explicit members of that channel. Public-channel visitors without a membership do not receive a durable inbox notification. The browser's local desktop alert can still appear while chat is open and permission/preference allow it.

The inbox lists only the authenticated recipient's rows. It resolves up to one page of targets in three visibility-filtered reads. It never uses a stored or client-provided href. Unknown, deleted, or newly private targets get a generic unavailable message with no action. Opening uses an authenticated POST that rechecks ownership and current target visibility, then marks that notification read and returns an allowlisted internal route. The exact destination page/API enforces its own authorization. A target revoked after the initial inbox read therefore fails closed when opened.

Legacy text-only notices remain readable, markable, and deletable without an action. The legacy self-notification POST cannot set destination fields or produce `FOLLOW`/`COMMENT` events; it exists for older clients during rolling upgrades. Current chat clients no longer write duplicate self-notifications. Keyset cursors carry a canonical account-scoped timestamp and ID so deleting the cursor row between pages does not break pagination. Older row-ID cursors remain accepted while clients upgrade.

Deployment must apply PostgreSQL upgrade `0007_notification_targets.sql` or SQLite migration `0008_notification_targets.sql` before running this code. Both add nullable columns and preserve historical rows; no backfill guesses a destination. The SQLite migration test covers fresh install, populated upgrade, checksum replay, and foreign keys. PostgreSQL execution still needs its CI/deployment service.
