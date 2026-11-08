---
type: UI Contract
title: Flower conversation sidebar
tags: [flower, sidebar, navigation, pins, interaction]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Desktop/Env App share ThreadID-owned rows, endpoint-owned pin ordering and canonical ThreadCache. Copy selection uses exact captured text after focus changes. Copy message uses normalized message content only on explicit action; weak row identity avoids transcript scans/backend reads.

# Contract

## Resizing
One 220–380 CSS-pixel desktop preference controls the grid track, at most once per frame. Drawer width applies only in overlay; mobile/companion/embedded sizes stay unchanged. One primary-pointer gesture settles on release/cancel/lost capture/blur/layout change/unmount, releases listeners/frames/shields and persists once (keyboard immediately). Storage failure cannot break input; resizing never reparses Markdown or invalidates history.

## Rename from the conversation header
The pencil edits the existing ThreadID during loading/execution with selected canonical title. Header/sidebar share save ownership/cache.

## Selection and detail reads
[Selection](flower-thread-selection.md) owns commitment, bounded reads, cancellation/recovery. Sidebar reserves feedback; ThreadCache owns committed selection/detail.

## Reference action
Right-click, More and Shift+F10 share one ThreadID menu; [references](flower-composer-references.md#thread-references) owns dedupe, preview and admission.

## Context menu response
Menus appear fully on the first frame with published compact tokens and 44px touch targets. Shared ResizeObserver supplies client border box to SurfaceFloatingLayer; Floe clamps/projects. Updates remeasure without replacing focus. Truncated paths retain hover text. Destructive text uses --error and 10% error hover/focus tint; disabled presentation stays disabled.

Links/editors/previews/terminals retain their own menus.

## Pending replies and approvals
Localized reply/approval labels sit beside titles with bounded progress width. Workspace updates require no selection.

## Pin ordering
The stable .flower-thread-rows contains real/skeleton inline sizes; movable cards are not size containers. Keyboard order matches search/overlay order. Time/directory views share one leading globally ranked pin region; menu/keyboard/drag cross directories, never duplicating pins. Heading identifies pins; no persistent decorative pin. Leading slot remains for work/unread; hover/focus or touch exposes the pin action. Pin/unpin retains row/focus and expands necessary batches. Failure undoes only its own presentation and reconciles via summary stream or one command read.

## Directory view
One title row holds Floe time/directory segmented control, workspace and refresh. Slow-duration/settle selection remains visible; narrow icons retain labels/tooltips without another row. Groups contain unpinned threads; pin-only directories remain creatable. Fixed open/closed folder slot follows aria-expanded, without arrows, indentation or tree rails. Full-path search distinguishes same names; trailing counts and load labels align. Show six, add six, reset on collapse.

Collapsed groups show a running wave before New only for unpinned running/stopping work, including unloaded batches. One summary grouping pass aggregates it; no per-header scan/query/poll/history read. New uses that directory without changing personal defaults.

Disclosure moves one reveal edge through actual row height/opacity with Floe 280ms slow/settle motion, never globally compressed spacing. Convert ms/s tokens correctly after minification. Early/middle frames must travel; following groups remain below shrinking content. Departing rows keep slots, immediately become inert/hidden, then unmount at zero. Reversal reuses measured height/opacity and identity; reorder has separate bounded motion. Running/focus survives. Search/background removals are immediate; mode switches use brief opacity without remounting; reduced motion disables transitions.

Host-scoped local order/view preferences use Desktop durable storage or Env App UI storage. Migrate renderer preferences only when host storage has none; failure preserves usability. Drag title rows without a grip/focus stop, showing pointer-following folder/count and whole-group insertion line. One rAF owns geometry/preview/edge scroll; only release saves once. Escape/cancel/blur/teardown/outside release discard and clean resources. Starting drag settles list motion. Alt+Up/Down and touch long-press are equivalents; swipes still scroll; search disables reorder.

Workspace uses published Dialog/Card/themes with two independent columns ordered down each column; batch expansion cannot rebalance. Fixed search precedes sole results scroller; narrow uses one column/44px targets. Product owns layout only. Leading global pins participate in search; cards hold unpinned rows/loading/New. One ThreadID owner moves rows between pins/directories, preserving focus/waves. Selecting clears obstructing filter, reveals pin or directory, expands only required batch and scrolls. Unpinning into collapsed directories expands before moving focus. Mobile reveal waits for drawer reopening; background updates never scroll.

## Stable presentation and convergence
Key rows by ThreadID and labels separately; publish each summary batch once under title/revision rules, retaining focus, menus and waves.

# Boundaries

[Storage](../ai/flower-storage-ownership-and-migrations.md) owns automatic upgrades; [read state](flower-read-state.md) owns confirmation/revisions. Detail success never acknowledges unseen content.

# Evidence

`FlowerThreadList.directory.browser.test.tsx` covers native mouse/touch, drag cancellation, disclosure frames, focus, pinned work, localization and persistence; `FlowerSurface.mobile.browser.test.tsx` covers deferred reveal. `scripts/check_flower_sidebar_responsiveness.mjs` measures production Electron motion, minified timing, reduced motion, bounded resize/one save and retained content without summary fetches. `scripts/check_flower_directory_persistence.mjs` tests real restart with durable storage and ephemeral partitions. Context-action browser/Electron tests cover immediate menus, editing and exact copy. Each runner cleans owned resources.
