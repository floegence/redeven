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

The full conversation header places a quiet pencil button beside the current
title when the host supports renaming. It remains available during execution
and detail loading; new conversations without a ThreadID have no rename action.
Long titles truncate while the button retains its hit area and the complete
title remains available as a tooltip. Touch layouts use the header's 44px target.
During inline editing, narrow headers move their other actions to a second row
so the input and controls remain usable.

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

## Selection and navigation

The rail acknowledges a selection with a short-lived navigation intent before
committing the conversation. The existing animation-frame plus task boundary
lets that highlight paint before ThreadCache selection, transcript projection,
scroll measurement and detail loading. Only the latest intent commits;
ThreadCache.selectedId remains the sole committed conversation identity.
Foreground detail requests cannot bypass this boundary through summary effects.

The previous title, body and draft stay together with a localized loading status
until commit. That conversation and its composer are inert; Send, Stop, input,
approval and Goal entry points also reject actions during the intent. The rail
remains available. An already captured immutable submission keeps its original
ThreadID and cannot cancel a newer navigation. Returning to the committed
conversation cancels the pending target without remounting its body. New chat,
external focus, embedded scope changes, deletion and disposal retain their
existing cancellation boundaries.

Deferred conversation selection keeps the focus owner from the original selection
intent. Finishing a load cannot reclaim focus after the user moves to the title
controls or another surface.

The mobile chat header opens the conversation drawer with a list-menu icon in a
quiet rounded-square control, with a 44px touch target and localized accessible
name. Its dialog popup and expanded semantics identify the conversation list;
it does not represent backward page navigation. Drawer placement and retained
page behavior follow [mobile Shell navigation](mobile-shell-navigation.md).

The selected conversation has a theme-tinted background stronger than hover and
a semibold title, without a left-edge marker. Selection retains `aria-current`,
visible keyboard focus, forced-color support and reduced-motion behavior. All
built-in themes must provide at least 4.5:1 selected-title contrast against the
selected row.
Light-theme title luminance is bounded using the current foreground token;
product CSS does not introduce a second palette.

Conversation selection, message reading and composing remain available during
pin commands. Reordering does not select a conversation, acknowledge reads, load
its transcript or reconnect transport. Ordinary conversations remain ordered by
creation time descending, then ThreadID ascending.

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
remains visible through the existing indicator. Narrow rows keep pinning in the
menu. Touch layouts show a status icon beside the always-visible menu, with 44px
action targets. Busy and stopping progress replaces the timestamp on the same
line and retains a polite screen-reader announcement.

Canonical runtime updates control entry and exit. Submitting a reply does not
optimistically clear the label; a failed submission leaves it visible while the
thread still needs a reply. Resuming or finishing removes the label, and accepted
cancellation takes precedence with the existing stopping feedback. Background
threads update through the same workspace stream without requiring selection.

## Pin ordering

Retained rows move through Element.moveBefore where supported. The stable
.flower-thread-rows owner provides inline-size containment for both real and
skeleton rows; movable cards must not themselves be size containers. This avoids
zero-size title/button layout after native moves in shipped Electron while
preserving ThreadID-owned nodes, keyboard focus and live wave animations. The
same named container query owns narrow-row status and action layout.

Pinned root conversations have one order per endpoint, shared by Desktop, Env
App and other windows in that environment. `pin_rank` descending is authoritative;
`pinned_at_unix_ms` records when the pin was created. A new pin receives the maximum
current rank plus one; unpinning clears both fields. Repeating an existing pin
does not reset its timestamp or manually chosen position.

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
It records geometry on animation frames plus screenshots and a Chromium trace
outside tracked source. Geometry and scheduling measurements do not alone prove
physical screen presentation; inspect the captured trace filmstrip as well.
