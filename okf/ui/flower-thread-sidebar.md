---
type: UI Contract
title: Flower conversation sidebar
description: Select conversations clearly and reorder endpoint-owned pins without interrupting live interactions.
tags: [flower, sidebar, navigation, pins, interaction]
timestamp: 2026-09-17T00:00:00Z
---

# Summary

Redeven owns conversation selection presentation and persistent pin order. Desktop
and Env App use the same Flower sidebar. Selection, running activity, unread
attention and approval requests retain independent meanings. Live summary changes
must preserve row identity, open menus, focus and running wave continuity. Pin
failures undo only the current operation's presentation and reconcile through the
existing workspace summary stream or one explicit post-command read.

# Contract

## Selection and navigation

The selected conversation has a theme-tinted background stronger than hover, a
3px inset left marker and a semibold title. The marker does not consume layout
space. Selection retains `aria-current`, visible keyboard focus, forced-color
support and reduced-motion behavior. All built-in themes must provide at least
4.5:1 selected-title contrast and 3:1 marker contrast against the selected row.
Light-theme title luminance is bounded using the current foreground token;
product CSS does not introduce a second palette.

Conversation selection, message reading and composing remain available during
pin commands. Reordering does not select a conversation, acknowledge reads, load
its transcript or reconnect transport. Ordinary conversations remain ordered by
creation time descending, then ThreadID ascending.

## Pin ordering

Pinned root conversations have one order per endpoint, shared by Desktop, Env
App and other windows in that environment. `pin_rank` descending is authoritative;
`pinned_at_unix_ms` records when the pin was created. A new pin receives the maximum
current rank plus one; unpinning clears both fields. Repeating an existing pin
does not reset its timestamp or manually chosen position.

Only a reserved drag handle starts native dragging. Its hover/focus visibility
does not shift titles. During dragging the displayed order stays fixed while live
content continues updating. An insertion line previews the target; edge scrolling
continues within the rail. A drop submits one relative move. Escape, drag end,
window blur, hidden sidebar, filtering or an invalidated source/anchor cancels the
gesture. A cancelled gesture submits nothing.

The same operation is available from the conversation menu through Move up and
Move down. Boundary actions are disabled, and remain focusable if a background
reorder makes the focused action unavailable. Disabled actions cannot execute.
Search exposes an explicit clear-search action before ordering can resume. Touch
and keyboard users use the menu; the handle is hidden on coarse pointers.

`PATCH /_redeven_proxy/api/ai/threads/{threadID}/pin-position` accepts
`{ anchor_thread_id, placement: "before" | "after" }`. The full-permission
boundary matches pin/unpin. One immediate SQLite transaction validates both
identities in the current endpoint, requires pinned root conversations, applies
the relative move to the complete current order, and advances affected ranks and
settings revisions. It preserves pin timestamps. Foreign or missing identities
are not disclosed; invalidated pin membership returns a conflict. The mutation
response contains changed pin metadata, not transcript data.

Relative moves never replace server order with the client's first 200 records.
Existing cursor encodings remain readable and pagination resolves the cursor
thread's current rank. A removed cursor anchor requires refreshing the list.
The compact conversation switcher consumes the same comparator within its
existing attention, working, pinned and recent grouping policy.

## Stable presentation and convergence

One sidebar row owner keys conversations only by ThreadID and group labels by
independent keys. Title, time, status, pin rank and group membership are values,
not identities. Existing rows and running wave elements survive group changes.
The sidebar uses `Element.moveBefore` when available. Other engines preserve wave
animation time and row focus around the same DOM move. This is local sidebar
behavior rather than a general rendering framework.

The menu belongs to the list and reads current data by ThreadID. Its action
components remain mounted during summary updates. Actual removal of a focused
action transfers focus within the menu. Explicit action selection, navigation,
filter changes, thread removal, outside interaction, keyboard dismissal, resize,
blur and sidebar visibility retain their normal closing behavior. Automatic
layout/scroll events do not dismiss a menu; explicit rail scrolling does.

`ThreadCache` remains the canonical summary owner. A short-lived pin operation
overlay presents immediate placement without authoring unrelated settings facts.
Only conflicting pin actions are blocked while a request and its post-command
read are pending. Revisioned acknowledgements remain visible until an equal or
newer canonical summary arrives, including when the read fails. Older responses
cannot overwrite newer streamed settings. Failed requests restore only their own
overlay, preserve newer titles/status/drafts, read the latest summaries once and
show localized feedback. No polling or second synchronization transport is added.

# Boundaries

The [storage contract](../ai/flower-storage-ownership-and-migrations.md) owns
automatic schema upgrades. The [streaming stability contract](flower-streaming-stability.md)
owns the broader interaction and runtime boundaries.

# Evidence

- `redeven:internal/flower_ui/src/threads/FlowerThreadList.tsx` - Shared interaction and menu actions.
- `redeven:internal/flower_ui/src/threads/FlowerThreadRows.tsx` - Retained rows and state-preserving movement.
- `redeven:internal/envapp/ui_src/src/ui/FlowerThreadList.reorder.browser.test.tsx` - 300 updates, action focus, animation phase, native dragging and all built-in themes.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.pinOrder.test.tsx` - Revision ordering, failed refresh and nonblocking navigation/composing.
- `redeven:internal/ai/threadstore/pin_order_test.go` - Complete ordering beyond 200 pins, persistence, concurrency and rollback.
- `redeven:internal/codeapp/appserver/server_ai_pin_order_test.go` - HTTP validation, permissions and endpoint isolation.
