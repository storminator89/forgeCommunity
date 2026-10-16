# Spaces: access and discussion guide

Spaces are separate topic rooms under `/community/spaces`. They do not replace
the global community feed. The directory, discussion lists and replies use
bounded cursor pages, with explicit load-more controls.

## Access and membership

- **PUBLIC / Offen für Mitglieder:** readable by authenticated community
  accounts. It is not an anonymous public web page. A signed-in account can
  explicitly join or leave; current membership is required to post or vote.
- **PRIVATE / Privat:** readable only by current members or a current stored
  administrator. Administrators add/remove members through the Space member
  manager; there is no self-join, invitation-link or join-request workflow.
- Administrators create Spaces and can read/manage private content without
  joining. Writing a discussion or reply still requires current membership.
  A moderator role alone does not grant administrator access to private rooms.
- There is no Space rename, visibility-change, archive or delete endpoint in
  this slice. Creation fixes the name, description and PUBLIC/PRIVATE mode.

Permissions are checked on the server using current stored account roles and
membership in the protected transaction, including replay paths. A direct URL
is not access. Missing/inaccessible Space content is unavailable to the caller.
Space read/error responses are `private, no-store`. Browser views recheck on
focus/visibility return, abort obsolete requests, and clear content when access
is lost; there is no server push to a continuously visible tab.

## Discussions and moderation

Current members can create a plain-text discussion and add replies. Authors
are named, and the thread uses its own Space-scoped URL. Administrators can
hide/unhide discussions and replies. Hiding a parent also makes its replies
unavailable to ordinary members; retained moderation content is not erased.
Readers can report available discussions/replies by other authors. Reports
carry a server-derived Space scope and are reviewed only by administrators,
including for PUBLIC Spaces. There are no discussion edit/delete or
media-upload endpoints in this slice.

Space discussions/replies are separate records, not global Post/Comment rows.
This implementation does not copy Space text into the global feed, search,
profiles, rewards or notification stream. Joining a Space never enrolls a
member into a course, practice session, mission or public ranking.

## Optional tools

### Voluntary polls

Administrators can create a question with 2–8 fixed choices in either Space
mode, close it permanently, or hide/unhide it. Current members choose one
option and may change it while the poll is open. Readers see totals and only
their own saved choice, with no voter list. This is not anonymous: small-group
counts can reveal choices, and account-linked votes are stored server-side.
Leaving does not withdraw an existing vote from totals. See the full
[poll visibility, retention and replay contract](SPACE-POLLS.md).

### Private-Space cooperative missions

In a PRIVATE Space, an administrator can open one voluntary teach-back relay.
Up to five eligible regular members join themselves, share insights, and build
on another participant's current insight. Two distinct insights plus one valid
cross-person build-on form a reversible cooperation milestone. It is not
comprehension assessment, a course completion, a grade or a reward.

An optional **Diese Lernwoche** selection attaches the current ISO Monday and
an explicit IANA zone. The following Monday at local midnight is a soft end:
the mission stays open for late participation until the administrator closes
it. There is no future scheduling, automatic next week, reset, reminder or
carried-over consent. Leaving a mission hides that participation's contributions
from members and reverses their credit; it does not change Space membership.
Named rosters and group changes can reveal participation. Retained admin audit
and withdrawal limits are explained in the [mission guide](COOPERATIVE-MISSIONS.md).

## Routes and implementation evidence

- `/community/spaces`: accessible Space directory and administrator creation
- `/community/spaces/[spaceId]`: discussions, membership controls and tools
- `/community/spaces/[spaceId]/discussions/[discussionId]`: discussion/replies
- `/community/spaces/[spaceId]/missions/[missionId]`: private mission detail
- [Server access rules](../lib/server/space-access.ts), [Space API helpers](../lib/server/space-api.ts), and [API routes](../app/api/spaces)
- [Space API/database regressions](../__tests__/api/spaces-db.test.ts), [mission journey](../e2e/cooperative-space-missions.pw.ts), and [poll journey](../e2e/space-polls.pw.ts)

On 16 October 2026, [PR #65 run 38871008041](https://github.com/storminator89/forgeCommunity/actions/runs/38871008041)
passed all seven jobs for head `0a8cead91c7f24609236bd516a61722d22472001`.
Its source tree `9ea80641be9e08520675503971124e76aeee0770` matches merged main
`38a0826458387056ea079d46797b3be4b7a36b96`; the separate
[main run 38872143016](https://github.com/storminator89/forgeCommunity/actions/runs/38872143016)
also passed all seven jobs. This includes PostgreSQL
mission/poll contracts and production-build browser journeys with disposable
synthetic data. [Selected actual screenshots and fixture limits](ui/README.md#current-space-captures)
are recorded separately. This dated integration evidence does not establish
production operational readiness, accessibility conformance or all-engine UX.
