---
type: UI Contract
title: Flower conversation sidebar
tags: [flower, sidebar, navigation, pins, interaction]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Desktop and Env App share one Flower sidebar with ThreadID-owned rows and endpoint-owned pin order. Selection, running work, unread attention and pending actions remain distinct. Live summaries preserve row/menu/focus identity. Resizing and pin feedback are ephemeral presentation over the canonical ThreadCache.

# Contract

## Resizing
One 220–380 CSS-pixel preference owns desktop sidebar width. Inline resizing updates only its grid track, at most once per frame; drawer width applies only in overlay mode. Mobile, companion and embedded layouts keep their sizing.

One primary-pointer gesture retains the latest sample and settles on release, cancellation, lost capture, blur, layout change or unmount. Release listeners, frames and cursor/selection shielding; persist once per gesture or immediately for keyboard changes. Storage failure cannot interrupt interaction. Width changes cannot reparse Markdown or invalidate the full transcript.

## Rename from the conversation header
The header pencil edits the existing ThreadID, including during execution/loading, with canonical title prefilled and selected. Header/sidebar share one save owner and thread cache.

## Selection and detail reads
[Selection](flower-thread-selection.md) owns deferred commitment, bounded reads, cancellation and recovery. ThreadCache owns committed selection/detail; sidebar intent reserves feedback only.

## Reference action
Right-click, More and Shift+F10 share the ThreadID-owned menu. [References](flower-thread-references.md) own deduplication, preview, admission and recovery.

## Context menu response
Sidebar and transcript context menus are fully visible on the first frame, without an entrance transition. Use published Floe compact row/control tokens on desktop and retain 44px touch targets. The shared resize observer supplies the measured client border box to `SurfaceFloatingLayer`; Floe owns clamping and projected coordinates. Live action changes remeasure without replacing the menu or losing focus. Long paths remain truncated with the full path available on hover.

## Pending replies and approvals
Localized reply/approval labels appear beside the title with bounded status/progress width. Background updates use the workspace stream without selection.

## Pin ordering
The stable `.flower-thread-rows` owner contains inline size for real/skeleton rows; movable cards cannot be size containers. Keyboard order matches visible search/pin-overlay order. Failed pin operations undo only their own presentation and reconcile via the existing summary stream or one explicit command read.

## Stable presentation and convergence
Key rows by ThreadID and group labels separately. ThreadCache owns summaries; each batch publishes once under existing title/revision rules, preserving menus, focus and running-wave continuity.

# Boundaries

The [storage contract](../ai/flower-storage-ownership-and-migrations.md) owns automatic schema upgrades.

Read confirmation and loaded-content revisions follow the canonical [read-state contract](flower-read-state.md). A successful detail fetch alone does not acknowledge unseen content.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerContextMenu.browser.test.tsx` - Tests.
- `redeven:internal/flower_ui/src/threadRailResize.test.ts` - Tests.
- `redeven:scripts/check_flower_sidebar_responsiveness.mjs` - --resize-only: real Electron drag, bounded styles, one save, retained Markdown/draft/scroll during streaming.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.titleRename.browser.test.tsx` - Tests.
- `redeven:internal/flower_ui/src/threads/threadListModel.ts` - Source.
