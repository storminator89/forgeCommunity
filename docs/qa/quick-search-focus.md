# Quick-search keyboard focus regression

The quick-search button and global Ctrl/Meta+K shortcut open a controlled Radix
dialog without a `DialogTrigger`. Radix therefore has no registered opener to
focus when the dialog closes. Before this fix, five focused DOM regressions
reproduced focus falling to `body` after Escape, keyboard activation of the
visible close button, and shortcut dismissal.

`components/navigation-search.tsx` now remembers the button or the element
focused when the shortcut opened search. Escape, visible close, outside
dismissal, and shortcut toggle return focus to that connected element. Choosing
a destination clears the old target so it does not compete with navigation or
try to focus inside a closing mobile drawer.

## Automated checks

- `__tests__/navigation-search-focus.test.tsx` uses real Radix components and
  Testing Library user-event for Tab, Shift+Tab, Enter, Escape, Ctrl+K, Meta+K,
  and reopening.
- `__tests__/app-navigation.test.tsx` covers nested quick search inside the real
  mobile navigation: the first Escape restores its opener in the drawer; the
  second closes the drawer and restores the header opener.
- `e2e/quick-search-focus.pw.ts` adds three acceptance cases through the existing
  CI Chromium projects, at 1280, 320, and 390px. It uses the public About page's
  real shared shell, keyboard-only traversal, both ends of the search focus
  trap, Escape, keyboard activation of visible close, reopening, nested mobile
  dismissal, and shortcut toggle. It creates no accounts or data and adds no
  success screenshots. Existing failure screenshots remain enabled.

The browser test is deliberately CI-only. Listing it is not execution, and the
new browser assertions have not been run locally. Run the existing supported
`browser-qa` CI job on the exact published commit before claiming browser proof.
DOM tests do not establish screen-reader announcements or WCAG conformance.

## Separate follow-up

Explicit JavaScript `behavior: 'smooth'` calls in community, members, and chat
remain a reduced-motion candidate. This focused patch does not change scrolling,
theme, zoom, or unrelated accessibility behavior.
