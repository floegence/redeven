---
type: UI Contract
title: Flower conversation sidebar
tags: [flower, sidebar, navigation, pins, interaction]
lifecycle: contract
reviewed_at: "2026-11-05"
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
Right-click, More and Shift+F10 share the ThreadID-owned menu. [References](flower-composer-references.md#thread-references) own deduplication, preview, admission and recovery.

## Context menu response
Sidebar and transcript context menus are fully visible on the first frame, without an entrance transition. Use published Floe compact row/control tokens on desktop and retain 44px touch targets. The shared resize observer supplies the measured client border box to `SurfaceFloatingLayer`; Floe owns clamping and projected coordinates. Live action changes remeasure without replacing the menu or losing focus. Long paths remain truncated with the full path available on hover.

## Pending replies and approvals
Localized reply/approval labels appear beside the title with bounded status/progress width. Background updates use the workspace stream without selection.

## Pin ordering
The stable `.flower-thread-rows` owner contains inline size for real/skeleton rows; movable cards cannot be size containers. Keyboard order matches visible search/pin-overlay order. Time and directory views share one leading pinned region, ordered by canonical global rank; keyboard, menu and drag moves cross directory boundaries. Pins never appear again inside a directory. The global pinned heading identifies pinned conversations; rows have no persistent decorative pin. Their leading slot remains available for running/unread state. Hover/focus reveals the actionable pin; touch keeps the action reachable. Pinning and unpinning retain the row and focus, expanding its batch when necessary. Failed pin operations undo only their own presentation and reconcile via the existing summary stream or one explicit command read.

## Directory view
The title row contains the published Floe segmented control beside the workspace and refresh actions. It switches between creation-time and full working-directory groups with one moving selected face using the published slow duration and settle curve, so the short icon-only travel remains visible. At narrow widths its icons retain accessible names and tooltips while labels hide; the control never takes a separate row. Directory groups contain only unpinned conversations; even a collapsed directory cannot hide its global pins. Directories containing only pins remain available for creating new conversations. Search includes the full path; duplicate directory names expose their distinct paths. Each group shows six conversations, adds six per request and resets that limit on collapse. Indented conversations and a quiet group rail distinguish directory ownership; counts align at the trailing edge. The incremental-load label aligns with conversation titles. A collapsed group displays the running wave immediately before its new-conversation button only when it contains unpinned running or stopping work, including work beyond the visible batch. The existing summary grouping pass counts activity once per update; headers read this aggregate without per-header scans, backend queries, polling or transcript reads. Explicit disclosure moves one reveal edge across the batch, animating actual row heights and opacity without compressing the spacing of all lines at once with Floe's slow duration (280ms) and settle curve, synchronized with the chevron. JavaScript converts both CSS `ms` and `s` tokens to milliseconds; production minification must not shorten the animation by a factor of 1,000. The first and middle frames must visibly travel rather than consuming nearly all height in an entrance snap; the following directory stays below the shrinking content. Departing rows retain their original flow slots, become inert and accessibility-hidden immediately, then unmount at zero height. Reversal starts from measured height and opacity and reuses their identity. Directory reorder retains its separate bounded position animation. Running waves and focus survive retained moves. Background updates and search remove rows immediately. Mode switches use a brief opacity change without remounting retained rows; reduced motion disables these transitions. The directory's new-conversation action starts a draft in that directory without changing personal defaults.

Directory order and the selected view are local preferences scoped to the host environment. Desktop supplies its existing durable state-storage bridge so preferences survive ephemeral renderer partitions and complete process restarts; Env App supplies its UI storage adapter. Hosts migrate a previously saved renderer preference when their own storage has none. Storage failure leaves the current preference and interaction usable. The directory title row supports dragging without a separate grip icon or redundant focus stop with a pointer-following folder/count preview and an insertion line at the whole group's boundary. One animation frame owns preview, measured target and bounded edge scrolling; ordinary pointer movement never persists order. Release commits the displayed target once. Escape, cancellation, blur, teardown and release outside the rail discard the gesture and clean preview, listeners, cursor and frames. Starting a drag settles pending list motion. Alt+Up/Down and touch long-press provide equivalent movement; ordinary touch swipes still scroll. Search disables reordering.

The workspace dialog uses published Floe Dialog/Card surfaces and theme tokens. Inset cards flow down two independent columns in directory order (down the first column, then the second). Expanding a batch never rebalances cards between columns. The search row stays fixed above the sole results scroller; narrow screens use one column and touch controls retain 44px targets. Published Floe owns control radii, selected surfaces and dialog presence; product styles own layout and hierarchy only. A leading global pinned region precedes every workspace card and participates in the same search. Cards contain unpinned conversations, incremental loading and directory creation. Cards retain path identity; one row owner moves ThreadID-keyed rows between the global pinned region and workspace containers, preserving focus and running-wave continuity across summary and pin updates. Choosing a conversation clears an obstructing sidebar filter, reveals its global pin or opens its directory, extends only the required batch and scrolls the row into view. Unpinning into a collapsed directory expands it and the required batch before moving the focused row. In a mobile drawer this reveal waits until navigation is shown again. Ordinary background updates do not scroll the sidebar.

## Stable presentation and convergence
Key rows by ThreadID and group labels separately. ThreadCache owns summaries; each batch publishes once under existing title/revision rules, preserving menus, focus and running-wave continuity.

# Boundaries

The [storage contract](../ai/flower-storage-ownership-and-migrations.md) owns automatic schema upgrades.

Read confirmation and loaded-content revisions follow the canonical [read-state contract](flower-read-state.md). A successful detail fetch alone does not acknowledge unseen content.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerContextMenu.browser.test.tsx` - Tests.
- `redeven:internal/flower_ui/src/threadRailResize.test.ts` - Tests.
- `redeven:scripts/check_flower_sidebar_responsiveness.mjs` - --motion-only: production Electron frame sampling for both slider directions and directory disclosure, minified CSS timing, reduced motion, no summary fetches and owned cleanup. --resize-only: real Electron drag, bounded styles, one save, retained Markdown/draft/scroll during streaming.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.titleRename.browser.test.tsx` - Tests.
- `redeven:internal/flower_ui/src/threads/threadListModel.ts` - Source.
- `redeven:internal/envapp/ui_src/src/ui/FlowerThreadList.directory.browser.test.tsx` - Native mouse/touch reorder, preview/cancellation/edge scroll, retained disclosure reversal, natural row spacing, measured early/middle and uninterrupted painted disclosure frames in both themes, fixed search and columns, running pins, localized light/dark desktop/mobile capture and preference persistence.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.mobile.browser.test.tsx` - Workspace selection reveals the conversation when reopening the mobile drawer.
- `redeven:scripts/check_flower_directory_persistence.mjs` - Real Electron restart with production Desktop storage/preload and an ephemeral renderer partition; owned processes, ports and state are cleaned up.
