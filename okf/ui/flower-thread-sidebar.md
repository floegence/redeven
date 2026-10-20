---
type: UI Contract
title: Flower conversation sidebar
description: Select conversations clearly and reorder endpoint-owned pins without interrupting live interactions.
tags: [flower, sidebar, navigation, pins, interaction]
timestamp: 2026-10-19T00:00:00Z
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

The header's pencil renames an existing ThreadID when supported, including
during execution and detail loading. Long titles truncate with a full tooltip
and retain the pencil hit area; touch targets are 44px. Narrow inline editors
move other actions to a second row.

The pencil replaces the title with an inline input, prefilled from the current
canonical title with its text selected. A checkmark saves; a close icon or Escape
cancels. Enter saves unless an input method is composing. Leaving the title
controls saves a changed nonempty draft without reclaiming focus. Empty or
unchanged drafts close without a request. Explicit save or cancel returns focus
to the pencil while focus remains in the editor; a completed request never takes
focus from the composer. Failed saves keep the input and draft with accessible
inline feedback. Saving prevents duplicate requests while navigation remains available.

Switching conversations dismisses the inline editor. A pending save still updates
its own canonical thread, but cannot close or overwrite another title editor or
reclaim its focus. The sidebar menu and double click retain their existing rename
dialog. Both entry points share one rename owner and canonical save path; header
and sidebar titles update through the existing thread cache.

## Selection and detail reads

[Conversation selection and detail reads](flower-thread-selection.md) owns deferred
selection, bounded shared reads, cancellation and recovery. ThreadCache remains
the sole committed selection and accepted-detail owner; sidebar intent only
reserves feedback presentation before that commit.

## Reference action

The same ThreadID-owned menu serves right-click, More and Shift+F10. Reference
this conversation appends a frozen basic snapshot to the current composer,
closes the menu and focuses the editor. It does not select the source, load its
transcript or send. Disabled editing states retain the action with an accessible
explanation, while navigation remains available. [Conversation references](flower-thread-references.md)
owns deduplication, preview, removal, admission and failure recovery.

## Pending replies and approvals

An unresolved input request shows the localized "Reply needed" label beside the
title; a pending approval shows its approval label in the same position. Both
replace the timestamp, whether the conversation is selected, pinned, read or
unread. The existing thread indicator owns this presentation through its
`actionRequired` and localized status values. Pending action labels do not use
unread dots or introduce a second lifecycle state.

Reply and approval labels use distinct message and shield icons with the published
info and warning colors on soft badges. Selection uses only its tinted row
background, without a left vertical accent. Every conversation entry stays on
one line, including operation progress and long translations. Titles and status
text truncate instead of wrapping. At a row width of 12.5rem or less, badges show
only their semantic icons; the complete status remains in the selection button's
accessible name and badge tooltip. Desktop typography is 13px for titles and
11px for status and time.

Status and pin/menu controls occupy the same trailing slot on desktop. Relative
times and dates retain their intrinsic width even on narrow rows; the title
yields space instead of truncating the timestamp. Status and progress text keep
their bounded width so longer translations cannot consume the whole row.
Hover or keyboard focus reveals actions without shifting the title; attention
remains visible through the existing indicator. Narrow desktop rows retain both
pin and menu buttons. Row-owned inherited values reveal actions after native DOM
moves. Touch layouts show a status icon beside the menu, with 44px
action targets. Busy and stopping progress replaces the timestamp on the same
line and retains a polite screen-reader announcement.

Canonical runtime updates control entry and exit. Submitting a reply does not
optimistically clear the label; a failed submission leaves it visible while the
thread still needs a reply. Resuming or finishing removes the label, and accepted
cancellation takes precedence with the existing stopping feedback. Background
threads update through the same workspace stream without requiring selection.

## Pin ordering

The stable .flower-thread-rows owner provides inline-size containment for real
and skeleton rows; movable cards cannot be size containers. This prevents
zero-size titles after native moves in shipped Electron. Its named container
query also owns narrow-row status and actions.

Pinned root conversations have one order per endpoint, shared by Desktop, Env
App and other windows in that environment. `pin_rank` descending is authoritative;
`pinned_at_unix_ms` records when the pin was created. New pins append to the end;
the same transaction reserves rank one and adjusts retained ranks without changing
their relative order or pin timestamps. Unpinning clears both fields. Repeating
an existing pin preserves its timestamp and manually chosen position. Pin
confirmations include the target and every changed rank/revision, so pending
appends converge without a list read. Epoch 67 requires this complete response.

Dragging a pinned conversation's title starts native sorting without reserving
space for a separate handle. Pinned and ordinary titles have the same inset.
A plain click still opens the conversation, a double click requests renaming,
and pin/menu buttons cannot initiate sorting. The localized title tooltip
explains dragging only when ordering is available. During dragging the displayed
order stays fixed while live content continues updating. An insertion line previews
the target; edge scrolling continues within the rail. A drop submits one relative
move. Escape, drag end,
window blur, hidden sidebar, filtering or an invalidated source/anchor cancels the
gesture. A cancelled gesture submits nothing.

The same operation is available from the conversation menu through Move up and
Move down. Boundary actions are disabled, and remain focusable if a background
reorder makes the focused action unavailable. Disabled actions cannot execute.
Search exposes an explicit clear-search action before ordering can resume. Touch
and keyboard users can complete sorting through the menu.

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
The Activity companion switcher uses the sidebar's exact filtering, pin and date
grouping model. Pins sort by descending rank; ordinary conversations sort by
descending creation time, then ascending ThreadID. Reply, approval, running,
queued and unread indicators stay inline and never promote a conversation.
Keyboard selection follows the same visible order, including search results and
the sidebar's short-lived pin presentation overlay.

## Stable presentation and convergence

One sidebar row owner keys conversations by ThreadID and group labels by separate
keys. Title, time, status, rank and group are values, not identities. Rows and wave
elements survive group changes through `Element.moveBefore`; other engines
preserve animation time and focus around the same move.

The menu belongs to the list and reads current data by ThreadID. Its action
components remain mounted during summary updates. Actual removal of a focused
action transfers focus within the menu. Explicit action selection, navigation,
filter changes, thread removal, outside interaction, keyboard dismissal, resize,
blur and sidebar visibility retain their normal closing behavior. Automatic
layout/scroll events do not dismiss a menu; explicit rail scrolling does.
Closing a menu after focus moves to another control preserves that new owner.

`ThreadCache` owns canonical summaries. Pin, unpin, menu moves and dragging stay
available during writes and reads. One in-memory queue serializes commands and
coalesces adjacent unsent toggles for the same thread. Pending commands replay
over canonical facts and revisioned acknowledgements; failures remove only the
failed command, preserve later intent and live content, and show localized errors.

Writes never await list reads. One coalesced background read reconciles each
drained batch, including unknown outcomes; completions during a read request
one follow-up read. Acknowledgements remain until equal or newer summaries
arrive, even after read failure. Stale responses cannot replace newer settings.
There is no polling or second transport. Each summary batch publishes once
through existing title/revision rules to avoid repeated transcript invalidation.

# Boundaries

The [storage contract](../ai/flower-storage-ownership-and-migrations.md) owns
automatic schema upgrades. The [streaming stability contract](flower-streaming-stability.md)
owns the broader interaction and runtime boundaries.

Read confirmation and loaded-content revisions follow the canonical
[read-state contract](flower-read-state.md). A successful detail fetch alone
does not acknowledge unseen content.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.titleRename.browser.test.tsx` - Header rename, save/cancel focus, failed saves, narrow titles and host capability.
- `redeven:internal/flower_ui/src/threads/FlowerThreadSwitcher.test.tsx` - Companion and sidebar order parity, filtering, status independence and keyboard selection.
- `redeven:internal/flower_ui/src/threads/threadListModel.ts` - One canonical filter, comparator and pin/date grouping model.
- `redeven:internal/flower_ui/src/threads/FlowerThreadList.tsx` - Shared interaction and menu actions.
- `redeven:internal/envapp/ui_src/src/ui/FlowerCompactPresentation.browser.test.tsx` - One-line geometry from 180px to 320px, long localized statuses, enlarged text and touch.
- `redeven:internal/envapp/ui_src/src/ui/FlowerStatusAndThreadMenu.browser.test.tsx` - Pending labels, hover, keyboard actions and touch layout.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.inputSubmission.browser.test.tsx` - Reply submission failure and background status convergence.
- `redeven:internal/flower_ui/src/threads/FlowerThreadRows.tsx` - Retained rows and state-preserving movement.
- `redeven:internal/envapp/ui_src/src/ui/FlowerThreadList.reorder.browser.test.tsx` - 300 updates, action focus, animation phase, native dragging and all built-in themes.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.pinOrder.test.tsx` - Revision ordering, failed refresh and nonblocking navigation/composing.
- `redeven:internal/ai/threadstore/pin_order_test.go` - Complete ordering beyond 200 pins, persistence, concurrency and rollback.
- `redeven:internal/codeapp/appserver/server_ai_pin_order_test.go` - HTTP validation, permissions and endpoint isolation.

## Qualification

Run node scripts/check_flower_sidebar_responsiveness.mjs for the installed
Desktop Electron version. The synthetic 247-thread / 610-entry fixture checks
click-path Markdown/projection isolation, warm click P95 below 8ms, three rail
widths, delayed pins, rollback, streamed titles, retained focus and animation.
It also checks rapid membership changes with delayed confirmations and a slow
list read, including zero disabled frames and writes accepted during that read.
It records geometry on animation frames plus screenshots and a Chromium trace
outside tracked source. Geometry and scheduling measurements do not alone prove
physical screen presentation; inspect the captured trace filmstrip as well.
