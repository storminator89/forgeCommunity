# New-member first-action guide

The community offers a small optional first-action guide after a successful **credentials registration in this browser**. The client seeds it only from the existing `/api/register` response with status `201` and a valid `userId`. It appears only when that exact account is authenticated as a regular `USER`. An existing account, another account on the same browser, a pending session, or a staff/instructor account does not receive the guide from that receipt. A failed automatic sign-in retains the receipt for a later manual login.

The guide links to the current feed, course directory, upcoming-events page and existing skill-settings tab. It does not create a profile, publish content, enrol the member, RSVP, ask for notification permission or change ranking consent. Choosing a link is not recorded as completion and awards no points, badges or milestones. The full community feed and composer remain available without completing or dismissing anything.

Skip and Reopen are equal, keyboard-accessible actions. Skip focuses the surviving Reopen button; Reopen focuses the guide heading. Initial arrival and cross-tab updates do not steal focus. The feed's heading is a focusable hash-link target. The guide has no forced overlay, animation or progress score.

## Persistence and limits

`lib/new-member-first-action.ts` stores only `open` or `dismissed` under a versioned, account-ID-keyed localStorage key. It stores no email, password, name, registration payload, chosen interest or learning/contribution data. The marker never enters a URL. An explicit Skip is not reset by a repeated receipt. This is a browser-only presentation preference, not an authoritative onboarding or authorization record.

Dismissal persists across visits for that account in that browser when storage is available. Other newly registered accounts retain independent state. Storage errors never block signup, login or Skip; a memory-only fallback lasts for the current client runtime and is lost on a full reload. The server snapshot is empty, so browser preferences are not embedded in server HTML or used to produce hydration differences.

Google signup does not currently expose a verified new-account receipt to this UI. The guide deliberately does not infer newness from blank profile fields, Google clicks or first login. Google/admin-created accounts, another browser/device, or cleared browser storage are not covered by this slice. Reliable provider-independent, cross-device onboarding requires a separate server-owned design; no migration, auth callback or reward changes are introduced here.

## Verification

Focused tests cover registration receipts and failed-autologin/manual-login recovery; account/session/role boundaries; per-account Skip and reopening; unavailable storage; cross-tab updates; keyboard focus; real destination links; no mutation or synthetic progress; and server/client hydration. Existing auth, community, reward and contribution tests remain separate regressions. `e2e/new-member-first-action.pw.ts` adds a guarded, disposable-database browser journey for UI registration, reading-anchor focus, keyboard Skip/Reopen, reload and switching between existing/new accounts. It must still run on the integrated application, alongside real 320px/light/dark/zoom/reduced-motion QA. Unit/JSDOM checks and test discovery do not establish those browser passes.
