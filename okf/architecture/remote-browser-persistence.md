---
type: Architecture Contract
title: Remote browser persistence
description: Restore managed pages and save browser library state without persisting authority.
tags: [architecture, browser, persistence]
timestamp: 2026-09-23T00:00:00Z
---
# Summary

- Authority: the environment ComputerUseRuntime owns Redeven browser metadata; Chromium owns cookies and website storage.
- Outcome: users reopen managed profiles and retain scoped bookmarks, history and zoom independently of Flower conversations.
- Invariants: only managed profiles restore URLs; current source events own recovery snapshots; metadata excludes private pages, credentials, form contents and control tokens.
- Failure boundary: incompatible product schemas fail read-only; browser failure retains the last eligible snapshot, and restoration requires a new explicit open.

# Product storage

The browser library is owned by the environment ComputerUseRuntime and is independent of Flower thread state and AI service readiness. The AppServer mounts its `/api/browser/library/` routes directly against that owner without acquiring an AI service lease. Profiles are scoped to the authenticated user and environment, and the product store records only source kind, tab navigation metadata, bookmarks, history and zoom. It does not read Chromium databases or persist cookies, form contents, control leases, media recordings, CDP endpoints or old input. Connected CDP and extension sources are observed from their current directory after reconnect; URL-only restoration is rejected.

[Browser source ownership](remote-browser-sources.md) defines admitted identities and private metadata boundaries. [The browser surface](remote-browser-surface.md) owns user-facing window operations.

Empty collection reads return explicit arrays. Admitting an already-running managed page records its current eligible URL once; another window or a title-only update does not add a visit.

# Library and restoration

The shared FloeBrowser library panel reads product bookmarks and history and
stores origin zoom through the environment owner's restricted product port.
Library identity is separate from managed-profile directory authority. Personal
Chrome keys derive from the connected profile identity; CDP keys derive from
the selected endpoint and browser context, with the endpoint hashed out of the
stored key. Neither external source imports native browser history or restores
pages from saved URLs. Only granted external targets with a live product view
generate history, and multiple views count one navigation once. Zoom restore
requires current control, and stale preference reads lose to navigation,
takeover or explicit zoom. Failed input never becomes a saved preference.

Source metadata and Runtime directory actions own managed-profile recovery snapshots. Clients can read these snapshots but cannot replace them. The shared source adapter reads browser-owned target metadata instead of executing website JavaScript to obtain a title. Metadata delivery keeps at most one unsent snapshot per admitted source or view. Private source metadata does not enter product history or recovery snapshots.

Snapshots contain restorable HTTP/HTTPS GET addresses, titles, ordering, pins and the most recently selected page. They exclude credentials embedded in URLs, script/data URLs, form contents, input tokens and prior Runtime target identities. Browser startup does not visit recovery addresses. An explicit profile-open request restores a stopped managed profile using fresh source identities; a second view of an already running profile observes its existing sources.

Restoration first admits a blank page, then starts one source-owned GET navigation under user-browsing policy. Directory admission does not wait for the website response or restore an input controller. The source projection owns visible loading and failure states; cancellation follows the published source lifecycle. Later title changes update history metadata without creating another visit. Source closure preserves the last snapshot if the whole live directory disappears, so a browser failure does not erase the next explicit-open recovery input.

# Evidence

- `redeven:internal/browserstore/schema.go` - Exact product-owned schema and fail-closed verification.
- `redeven:internal/browserstore/store.go` - Owner-scoped profiles, recovery tabs, history, bookmarks and zoom.
- `redeven:internal/ai/computer_browser_library.go` - Library authorization and service ownership.
- `redeven:internal/ai/computer_browser_workspace.go` - Explicit-open restoration with fresh source identities.
- `redeven:internal/ai/computer_browser_persistence.go` - Source-derived recovery and private metadata exclusion.
- `redeven:internal/ai/computer_browser_workspace_test.go` - Restoration and history behavior.
- `redeven:internal/codeapp/appserver/browser_api_test.go` - Browsing without AI readiness and authenticated owner isolation.
