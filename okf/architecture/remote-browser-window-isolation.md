---
type: Security Contract
title: Remote browser window isolation
description: Admit independent browser documents without lending environment APIs or Desktop IPC authority.
tags: [architecture, browser, desktop, security]
timestamp: 2026-09-29T00:00:00Z
---
# Summary

- Authority: the environment window owns Session credentials and private product ports; Desktop owns static-document reservations and child window lifetime.
- Outcome: a visible independent browser window uses the same browsing surface without becoming an environment or IPC owner.
- Invariants: exact document nonce and source, one-time reservations, static GET-only asset grants, and no generic fetch or Desktop bridge in the child.
- Failure boundary: parent destruction retires reservations and grants before closing children; document replacement cannot reuse retired ports.

# Contract

The trusted document is a static shell without a view identity or source data.
Its URL carries only a fresh instance nonce, also checked against the exact
opener or parent before handing over ports. A source replacement changes the
query as well as the nonce, so the browser loads a new document instead of doing
a fragment-only navigation with retired ports. Desktop reserves that exact URL
once and gives the child no preload or generic bridge.
Parent destruction or navigation retires reservations and static-document grants
before closing child windows. Cleanup detaches from the captured WebContents
event emitter without reading an already destroyed BrowserWindow; repeated
teardown and previously closed children remain harmless.
Desktop presents the independent window at creation. Its visible shell owns
loading and recovery; a paint event must not gate the user's window visibility.
For a Desktop private Local UI bridge, the main process lends authentication
headers only to that child's reserved static document and same-origin Env App
assets. The child is not registered as an environment or IPC owner; API paths,
other origins, other document instances and non-GET requests receive no grant.


Window source selection, view recovery and presentation belong to the
[remote browser surface](remote-browser-surface.md). Authenticated DOM, input,
media and file traffic follow [browser transport](remote-browser-media.md).
These documents never acquire authority from a cached page or Local UI cookie.

# Evidence

- `redeven:desktop/src/main/browserProjectionWindows.test.ts` — Exact static-document loading, restricted asset grants and idempotent cleanup after parent destruction.
- `redeven:internal/envapp/ui_src/src/browserDocument.browser.test.tsx` — Source/nonce handshake and private host port behavior.
- `redeven:internal/envapp/ui_src/src/ui/services/browserWindow.ts` — Named parent-owned operations and document replacement.
