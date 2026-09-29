---
type: Architecture Contract
title: Live personal browser workspace
description: Open all ordinary Chrome tabs and recover individual projections without changing native focus or Flower authority.
tags: [architecture, browser, workspace]
timestamp: 2026-09-29T00:00:00Z
---
# Summary

- Authority: Chrome owns tab facts; ComputerUseRuntime authorizes workspace visibility; FloeBrowser owns each window's selection and lazy page projection.
- Outcome: opening a personal profile shows all ordinary native tabs, including tabs not previously projected. Each window selects independently without changing Chrome focus.
- Invariants: one event-driven directory, one source owner per native page, stable workspace and tab identities independent of binding generations, and separate viewing and input grants.
- Failure boundary: a failed projection keeps its tab and browser chrome. Unknown native mutation outcomes reconcile the directory without repeating creation, navigation or input.

# Contract

## Directory and authorization

Opening an explicitly selected profile grants its authenticated owner a live
workspace. One initial native snapshot is followed by contiguous revisions for
create, close, move, attach/detach, replacement, navigation, pin and title events.
Concurrent events invalidate an in-flight snapshot and coalesce into its pending
update. There is no directory polling. Runtime validates complete updates before
publishing them; malformed revisions or an unavailable profile fail closed.
Failure to publish privacy-filtered metadata or grants retires the profile's
connection and views rather than retaining a live, stale directory.

Incognito and the connection extension's own pages are excluded. Ordinary
browser-internal pages stay visible with an explicit unsupported projection
state. Existing private sessions and native opener ancestry remain governed by
[browser source ownership](remote-browser-sources.md); new workspace visibility
cannot bypass those barriers. Native directories and viewing grants are bounded
to 128 tabs, while the existing source-owner limits remain separate.

Metadata contains identity, URL, title, native order, pin, loading and availability.
FloeBrowser's released SourceDirectory resolves a page only when needed for
projection. Listing or changing metadata never starts a debugger or gives Flower
control. Simultaneous selection reuses the same source connection; obsolete
selection work cannot overwrite a newer selection. Projection changes do not
activate native tabs, focus Chrome windows or move the pointer.

## Identity and native mutations

A workspace has an independent Runtime identity. Window creation, presentation
changes and reconnect use that identity plus the window's selected tab. Native
target identity survives projection disposal and extension binding replacement.
A Flower resource plan's reserved target identity is retained when its native
page later joins the same workspace; both consumers use one connection owner.
Reusing a product projection still validates an explicit Flower selection's
current native URL and title. Existing observation is never an AI admission grant.

Create, close, move and pin commands update the directory only after native
confirmation. Creation returns the real tab identity independently of projection;
a failed display cannot close the newly created page. Closing the final personal
tab leaves an empty directory with New tab available. No blank replacement is
created, and no personal URL restoration is offered.

A known failed display offers Retry display for that exact tab. An unknown
creation/mutation result requests one directory reconciliation and reports the
uncertainty; it never repeats the effect. A close decision on an admitted source
uses its existing beforeunload and target-input gate. Unprojected tabs close by
verified native identity without attaching a debugger.

# Boundaries

## Failure and reconnect

Per-page loading, unsupported, unavailable and empty states stay in the released
engine's content area, preserving tab chrome and healthy tabs. A profile carrier
loss revokes its views and input, while the product controller retains workspace
and selected-tab intent for an explicit reconnect. Reconnection finds the same
persistent profile on the current extension connection, obtains its native
snapshot and issues fresh view grants. It cannot restore old input tokens or
Flower bindings.

Native detach and source carrier failures expose only fixed failure stage/reason,
opaque target and binding generation. They do not log page content, credentials
or input. Late close, metadata and fault events from a retired binding cannot
modify its replacement. Exact-generation native detach must finish before a
replacement source can reuse that native page.

# Evidence

- `redeven:browser-extension/background.mjs` — Native directory stream and identity-checked mutations.
- `redeven:internal/ai/computer_browser_profile_workspace.go` — Visibility, lazy resolution, mutation reconciliation and reconnect.
- `redeven:internal/ai/computer_extension_directory.go` — Atomic ordered-delta validation.
- `redeven:internal/ai/computer_browser_profile_workspace_test.go` — Independent selections, empty workspace, uncertain create/close outcomes, invalid directory and shutdown.
- `redeven:internal/envapp/ui_src/scripts/computerExtensionDirectory.node-test.mjs` — Native metadata, no eager attachment and snapshot/close race.
- `redeven:internal/ai/computer_extension_test.go` — Explicit Flower selection remains validated when reusing a product projection.
- `redeven:internal/envapp/ui_src/src/ui/services/browserWorkspaceController.test.ts` — Selected-tab retention across carrier and Session loss.
- `redeven:internal/envapp/ui_src/scripts/checkBrowserProjection.mjs` — Desktop/Native Messaging verification of multiple native windows, explicit reconnect, empty directories and injected projection loss without duplicate native effects.
- [FloeBrowser v0.1.26: test/session-directory.test.ts](https://github.com/floegence/floebrowser/blob/v0.1.26/test/session-directory.test.ts) — Lazy directory failure and grant-refresh independence.
