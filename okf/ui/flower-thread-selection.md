---
type: UI Contract
title: Flower conversation selection and detail reads
description: Present navigation feedback before committing content and coordinate bounded canonical detail reads.
tags: [flower, navigation, cancellation, recovery, detail]
timestamp: 2026-10-19T00:00:00Z
---
# Summary

Flower presents the latest selection intent before transcript work and uses one
coordinator for navigation, command confirmation and reference preflight reads.
ThreadCache owns committed selection and accepted detail; the loader owns only
bounded ephemeral demand.

# Contract

## Selection and navigation

The rail acknowledges a selection with a short-lived navigation intent before
committing the conversation. Four cancellable animation frames and a task
reserve style, paint and compositor presentation before ThreadCache selection,
transcript projection, scroll measurement and detail loading. Selection has no
background transition. Only the latest intent commits;
ThreadCache.selectedId remains the sole committed conversation identity.
Foreground detail requests cannot bypass this boundary through summary effects.

The previous title, body and draft stay together with a localized loading status
until commit. A capture guard blocks old conversation interactions; Send, Stop,
input, approval and Goal also reject the intent. Native inert must not restyle
the history, and the status node stays mounted so inserting it cannot invalidate
Markdown first-child selectors. The rail remains available. An already captured immutable submission keeps its original
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

## Detail read ownership

Published Floret v7.69.1 already supplies ThreadSummaryReader.Summary. Point
reads and live summary publication use that exact authorized ThreadID; root List
belongs only to inventory, and child lists retain ParentID. Flower does not own
another summary projection, persisted detail cache, or migration.

[threadDetailLoader](../../internal/flower_ui/src/threadDetailLoader.ts) owns
only ephemeral demand. ThreadCache remains the sole owner of accepted detail
and committed selection, bounded to twelve detail entries. Each ThreadID has
one active read and one merged successor target. Targets include connection
epoch, activity/settings revisions, runtime status and explicit invalidation.
One drain dispatches successors; identical failed targets wait for an advanced
target or explicit Retry. Released idle records are pruned with cache retention.

Navigation releases its demand at selection intent. Command confirmations and
reference preflights share a request only when its target is fresh enough.
Confirmation invalidates after the command acknowledgement, so an earlier GET
cannot satisfy it. Releasing one consumer cannot cancel another; releasing the
last aborts the read. The 15-second read deadline aborts transport and releases
UI ownership. Epoch reset, deletion and disposal settle every waiter and reject
late publication. Commands keep their separate 120-second uncertain-result
contract. A confirmed command followed by a failed refresh stays confirmed;
Retry refreshes detail without replaying the command or restoring consumed input.
Adapters do not hide post-command GETs.

Cached history remains visible during refresh and after failure, with a Retry
exit. Cold reads end as content or a retryable error. Four visible feedback
frames still precede content commit. Hidden documents commit through a timer;
visibility changes reschedule the same cancellable, idempotent commit. Reference
preview closure releases its preflight and prevents late navigation. Neither
selection nor detail cancellation reconnects the workspace stream.

# Boundaries

The [sidebar contract](flower-thread-sidebar.md) owns conversation rows, title
editing, pending-action presentation and pin ordering. The
[read-state contract](flower-read-state.md) owns acknowledgements for actually
presented content. A completed detail read alone never marks content as seen.
[Desktop runtime bridge](../desktop/desktop-runtime-bridge.md) owns transport
cancellation and document isolation. Canonical View and Summary stay in
Floret; the host does not reconstruct its history or lifecycle.

# Evidence

- `redeven:internal/flower_ui/src/threadDetailLoader.test.ts` - Shared demand, fresh confirmations, cancellation, explicit retry, settlement and bounded idle records.
- `redeven:internal/flower_ui/src/threadSelectionSchedule.test.ts` - Visible feedback, hidden documents and idempotent commit cancellation.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.navigation.test.tsx` - Latest selection, retained drafts and interaction ownership.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.threadReferences.browser.test.tsx` - Preview closure and late response rejection.
- [Performance and recovery qualification](../operations/flower-thread-switch-qualification.md) - Synthetic point-read scaling and actual selection presentation.
