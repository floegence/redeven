---
type: UI Contract
title: Flower Activity companion
description: Activity keeps one low-profile Flower companion in product flow while Workbench retains its independent widget.
tags: [ui, flower, activity, companion, read-state, floret]
timestamp: 2026-07-22T00:00:00Z
quality_exception: Cross-surface UI contract spanning Activity shell placement, shared Flower projection, contextual launch admission, and Workbench isolation.
---
# Summary

Activity exposes Flower as one background-capable companion rather than a second page. The bottom bar is the desktop ambient entry; the Activity Bar is the mobile and explicit entry. The companion expands in normal document flow into docked or maximized presentation, and the same `FlowerSurface` instance owns the selected thread, composer drafts, live projection, approvals, and settings. Workbench keeps its existing Flower widget, coordinate system, floating launcher, focus request, and canvas input ownership.

The companion consumes an adapter-provided merged projection: Floret remains authoritative for admitted threads, turns, runs, messages, activity, approvals, todos, input requests, and lifecycle state, while Redeven owns product thread settings, queued follow-up commands, and user-scoped `read_status`. The adapter composes those sources into the summary/detail contract consumed by Flower. The companion does not copy transcripts, reconstruct events, add a protocol, or persist Floret lifecycle state; Redeven owns only the product placement, ephemeral launcher drafts, local height preference, read-status calls, and host navigation described here.

If the adapter or exact canonical bootstrap fails, the companion projects an unavailable/error boundary, keeps live consumption and read acknowledgement disabled, and never replays a local transcript. Re-entry to `engaged` requires a successful exact bootstrap and after-paint presentation before live/read behavior resumes; Workbench remains on its independent existing recovery path.

# Contract

## Activity placement

After the access gate succeeds, Activity mounts exactly one Flower companion instance in the Activity shell. A collapsed instance remains mounted for summary refresh and presence projection but has no pointer or read ownership. Desktop expansion is `collapsed -> docked -> maximized`; mobile opens directly to maximized from the Activity Bar. Docked height is bounded by the available viewport and a 240px minimum; when the viewport cannot satisfy that minimum the same instance uses maximized layout. The resize separator is keyboard-operable and reports its current value through ARIA.

The companion is a normal-flow shell band above the existing bottom bar. It is not a fixed drawer, global overlay, floating window, or second page. The Activity content remains the user's primary workspace in docked mode; maximized mode temporarily hides the content region without changing the Activity surface id or destroying the companion. Collapse restores the trigger or originating mobile element without clearing drafts or stopping a run.

## Conversation navigation

The companion header title opens a compact, searchable, keyboard-navigable switcher. It groups each canonical thread once as attention, working, pinned, or recent and exposes a local New conversation action. A new conversation is an in-memory pending draft until the first accepted admission; existing per-thread drafts remain keyed by thread id. The switcher is a controlled UI projection and never owns canonical thread state.

Activity contextual Ask Flower uses the shared launcher submit and context-action contract inside the companion. Its `launcherDraft` is separate from the ordinary Flower composer draft and is keyed by intent id, so switching intent cannot silently overwrite text. Admission success or typed uncertain admission closes the inline launcher and focuses the exact receipt or proposed thread in the same companion; rejection preserves the launcher draft. Workbench continues to use the existing floating launcher and Widget handoff.

## Presence and read acknowledgement

Bottom-bar presence is a pure projection with this priority: attention, unread failure, running, queued, unread canceled, unread completed, unavailable, idle. Each thread contributes to at most one category. It uses the adapter's merged canonical summaries, including Redeven's user-scoped `read_status`; it does not infer completion from a transport event or local timer. Read-state ownership and validation remain defined by [Flower approval and context](flower-approval-context.md).

Every Activity-companion `markThreadRead` call passes one final gate. The gate requires Activity foreground, document visibility, engaged companion, no inline launcher, current chat panel, exact selected detail, a matching after-paint content-presented token, no bootstrap/loading/error state, and the current selection sequence. Collapsed, background, Workbench foreground for the companion, staging, hidden transcripts, and launcher presentation cannot acknowledge read. Background polling refreshes summaries, including a selected running thread, but consumes selected live events only after the companion re-enters engaged state and reloads the exact canonical bootstrap.

## Ownership boundary

Floret owns the canonical turn/run/message/activity, approval, input, todo, and lifecycle projection. Redeven owns product thread settings, queued follow-up commands, and user-scoped read acknowledgement state; the existing adapter composes these with Floret snapshots into the Flower contract. The Activity companion owns only placement, ephemeral UI presence, focus request routing, local drafts, and visual state, and must not add a transcript cache, event reducer, thread database, lifecycle endpoint, or alternate admission path.

# Boundaries

`EnvSurfaceId='ai'`, the Workbench Flower widget, `aiThreadFocusRequest`, Workbench geometry, wheel guards, floating layers, and canvas handoff remain intact for Workbench. Activity does not register an `ai` page; legacy Activity `ai` persistence migrates to the last non-Flower Activity surface and companion expansion. Activity focus requests use a distinct request namespace and are never consumed by Workbench.

The companion must not auto-expand for a completed, failed, approval, or input state. Presence communicates attention without stealing focus. Explicit bottom-bar, Activity Bar, Ask Flower, or New conversation actions are the only expansion triggers. Escape closes secondary switchers or launcher first, returns maximized to docked, and finally collapses while preserving state.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:3697` - Activity's single normal-flow companion shell and `:3758` - explicit presence ownership passed independently of maximized visual presentation.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:2720` - exact read-acknowledgement gate and `:3340` - canonical summary refresh ownership independent of `full`/`companion` layout.
- `redeven:internal/flower_ui/src/flowerCompanionPresence.ts:52` - pure priority projection that consumes canonical summary fields without local lifecycle state.
- `redeven:internal/flower_ui/src/FlowerSurface.visibility.test.tsx:375` - summary-only canonical queue projection, `:400` - maximized Activity discovery, and `:466` - bootstrap-failure recovery gate.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.desktopFloatingSurfaces.e2e.test.tsx:687` - one Activity instance across collapsed/docked/maximized states and `:793` - Activity launcher handoff isolation from Workbench.
- `redeven:internal/flower_ui/src/threads/FlowerThreadSwitcher.tsx:83` - controlled compact conversation projection; canonical selection remains owned by `FlowerSurface`.
