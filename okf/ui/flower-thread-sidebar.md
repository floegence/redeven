---
type: UI Contract
title: Flower conversation sidebar
description: Select conversations clearly and reorder endpoint-owned pins without interrupting live interactions.
tags: [flower, sidebar, navigation, pins, interaction]
timestamp: 2026-10-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns conversation selection presentation and persistent pin order. Desktop
and Env App use the same Flower sidebar. Selection, running activity, unread
attention and pending replies or approvals retain independent meanings. Live summary changes
must preserve row identity, open menus, focus and running wave continuity. Pin
failures undo only the current operation's presentation and reconcile through the
existing workspace summary stream or one explicit post-command read.

# Contract

## Rename from the conversation header
The header's pencil renames an existing ThreadID when supported, including during execution and detail loading.

The pencil replaces the title with an inline input, prefilled from the current canonical title with its text selected.

Both entry points share one rename owner and canonical save path; header and sidebar titles update through the existing thread cache.

## Selection and detail reads
[Conversation selection and detail reads](flower-thread-selection.md) owns deferred selection, bounded shared reads, cancellation and recovery. ThreadCache remains the sole committed selection and accepted-detail owner; sidebar intent only reserves feedback presentation before that commit.

## Reference action
The same ThreadID-owned menu serves right-click, More and Shift+F10. [Conversation references](flower-thread-references.md) owns deduplication, preview, removal, admission and failure recovery.

## Pending replies and approvals
An unresolved input request shows the localized "Reply needed" label beside the title; a pending approval shows its approval label in the same position.

Status and progress text keep their bounded width so longer translations cannot consume the whole row.

Background threads update through the same workspace stream without requiring selection.

## Pin ordering
The stable .flower-thread-rows owner provides inline-size containment for real and skeleton rows; movable cards cannot be size containers.

Keyboard selection follows the same visible order, including search results and the sidebar's short-lived pin presentation overlay.

## Stable presentation and convergence
One sidebar row owner keys conversations by ThreadID and group labels by separate keys.

`ThreadCache` owns canonical summaries.

Each summary batch publishes once through existing title/revision rules to avoid repeated transcript invalidation.

# Boundaries

The [storage contract](../ai/flower-storage-ownership-and-migrations.md) owns automatic schema upgrades.

Read confirmation and loaded-content revisions follow the canonical [read-state contract](flower-read-state.md). A successful detail fetch alone does not acknowledge unseen content.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.titleRename.browser.test.tsx` - Header rename, save/cancel focus, failed saves, narrow titles and host capability.

- `redeven:internal/flower_ui/src/threads/FlowerThreadSwitcher.test.tsx` - Companion and sidebar order parity, filtering, status independence and keyboard selection.

- `redeven:internal/flower_ui/src/threads/threadListModel.ts` - One canonical filter, comparator and pin/date grouping model.
