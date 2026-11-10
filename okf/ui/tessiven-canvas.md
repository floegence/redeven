---
type: UI Contract
title: Tessiven canvas navigation, relationships and Flower reading
tags: [ui, tessiven, graph]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Published Floe owns graph layout/routing/paint; Tessiven supplies canonical topology and details. Browser popup and native opening failures remain visible; never silently choose another route. Read-only document inspection preserves exact saved bytes and never changes canvas versions or navigation authority.

# Contract

## Canvas surfaces
Connected environments and Runtime details follow [scoped operations](../ai/tessiven-runtime-operations.md#runtime-operations). Distinct infrastructure responsibilities have distinct icons; repeated instances retain the same icon.

## Navigation and rendering
### Layout and routing
Canvas and thumbnails share Floe direction/layers/visibility. Saved positions order within rank, never override it. Isolated positioned nodes contribute actual bounds for fit.

### Connection scopes
Default overview has one directed connector per root endpoint pair; internal relationships remain in canonical overview without group self-loops. Overview/thumbnails always paint root scope, even during focused-host detail.

### Controls and rendering
Expand/collapse all groups reflows once, preserving selected visible object or enclosing group, without a document version. Large-graph tests count actual hosts, including grouped hosts.

## Document reading
View document lazily opens exact saved YAML in Floe's read-only themed code viewer: line numbers, guides, folding/find, default wrap and explicit wrap toggle. Escape closes find before dialog. Filename identifies canvas/version; copy/export preserve bytes, not reserialization. Plain source remains readable during loading; clipboard errors remain visible. Reading never changes versions.

## Relationship summaries
### Group summaries
Patterns use ordered canonical endpoints/granularity, kind, exact protocol and locality. Canvas/thumbnail share projection; raw relationship count never expands every group header.

### Interaction and details
Hover/focus never opens popups; lists never silently truncate at 100 references.

## Flower replies
### Reading surface
One opaque themed reading surface spans title/transcript/composer, with restrained border/shadow and compact spacing. End padding keeps final choices readable; actions stay outside fade.

### Actions and continuity
Each canvas owns multiple conversations with exactly one active. More offers new/history with active indicator, settings, subagents, available Computer actions and files. Activate history before opening composer. New drafts replace active identity only at canonical admission; returning preserves drafts. Copy/export/explicit fork remain shared across Desktop/Env.

Ongoing root/child work disables switching/new; server rejects stale activation, preserving visible errors/selection. Stop or settle first; switching never cancels implicitly. Live canvas metadata owns selection. Late admission refreshes it rather than posting another selection; canvas/visibility changes preserve drafts. Ordinary navigation, including stale ThreadID/live receipts, never renders canvas conversations. Existing content waits for product metadata; provisional new-thread receipts retain submitted canvas ownership. All messages/tools/questions/approvals/errors stay canonical; existing canvases open the combined window directly.

# Boundaries

The iOS host bundles shared TessivenGraph and published Floe as fixed resources. Data-only loading/rendered/failure/immutable selection messages are validated against canvas/version/objects before native details/Flower. Ask Flower focuses without sending.

### Explicit Group Packing
The shared mapper passes only visible presentation.groupLayouts to Floe; no second layout engine/menu. Browsing changes scenes, not saved topology/versions. Worker faults never produce guessed routes; culling cannot alter inspectable models. Native hosts share summary browsing/exact-object callbacks and load foundation plus graph styles. Canonical indexes/Set deduplication bound aggregation without another graph/router.

### Product verification
A rendered component or dev-server HTTP 200 is not connected Env acceptance. Both hosts must send a turn, display canonical streaming and exercise the compact reply menu using owned browser/Runtime fixtures.

# Evidence

internal/envapp/ui_src/src/styles/tessiven-document.browser.test.tsx covers syntax/themes/wrap/read-only/find/copy/export. desktop/src/shared/desktopShellServiceCanvasWindowIPC.ts and desktop/src/main/main.ts own identity-only native request/ACK; native acceptance covers open/repeat/close/reopen and invalid rejection.
