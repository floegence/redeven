---
type: UI Contract
title: Flower conversation sidebar
tags: [flower, sidebar, navigation, pins, interaction]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Shared Desktop/Env rows are ThreadID-owned, pins endpoint-owned and details canonical ThreadCache-owned. Copy selection uses captured text after focus changes; explicit Copy message normalizes only that message. Weak row identity avoids transcript/backend scans.

# Contract

## Resizing
One220–380CSSpx desktop preference updates grid at most once/frame; overlay/mobile/companion/embedded sizes remain separate. Primary-pointer gesture settles on release/cancel/capture loss/blur/layout/unmount, cleans resources and saves once; keyboard saves immediately. Storage failure cannot break input or reparse Markdown/history.

## Rename from the conversation header
Pencil edits existing ThreadID during loading/execution with selected canonical title. Header/sidebar share save/cache ownership.

## Selection and detail reads
[Selection](flower-thread-selection.md) owns commitment/bounded reads/cancellation; sidebar reserves feedback, ThreadCache owns committed detail.

## Reference action
Right-click/More/Shift+F10 share a ThreadID menu; [references](flower-composer-references.md#thread-references) owns dedupe/preview/admission.

## Context menu response
First-frame complete menus use compact published tokens/44px touch targets. One ResizeObserver provides client border box; SurfaceFloatingLayer clamps without replacing focus. Truncated paths keep hover text. Destructive text uses error ink/10% tint; disabled stays disabled. Links/editors/previews/terminals retain their menus.

## Pending replies and approvals
Localized labels sit beside title within bounded progress width; updates require no selection.

## Pin ordering
Stable .flower-thread-rows owns actual/skeleton inline size; movable cards are not size containers. Keyboard/search/overlay order matches. Both views have one globally ranked pin region spanning directories; never duplicate pins. Heading identifies pins without permanent decorative pin. Leading slot remains for work/unread; hover/focus/touch exposes pin. Retain row/focus, expand required batches; failure reverses only its own presentation and reconciles via stream/one command read.

## Directory view
One title row has time/directory control, workspace and refresh. At header content widths up to18rem (22.5rem for coarse pointers), both modes show only centered icons; wider headers restore localized labels. The published SegmentedControl label slot controls native and selected ink together. Full accessible names/tooltips, focus, selection and44px touch targets remain. Thresholds reserve title space and follow the local container, never window width. Groups contain unpinned rows; pin-only directories still support New. Fixed folder slot reflects aria-expanded without arrows/tree rails. Full-path search distinguishes names; counts/loading align. Six initial/six more/reset on collapse. One summary pass aggregates collapsed unpinned running/stopping waves, including unloaded batches, without header scans/polls/history. New uses directory without changing personal defaults.

Disclosure moves one measured edge through height/opacity using280ms Floe motion, correctly handling minified ms/s; early/middle frames travel and following groups stay below. Departing rows retain slots but immediately inert/hidden, then unmount. Reversal reuses height/opacity/identity; reorder motion is independent. Retain work/focus. Search/removals are immediate; mode change only brief opacity/no remount; reduced motion disables transitions.

Preferences use host storage; migrate renderer values only if absent, preserving usability on failure. Drag title (no grip/focus stop) shows folder/count and whole-group insertion line; one rAF owns geometry/preview/edge-scroll, release saves once. Escape/cancel/blur/teardown/outside release discards resources. Drag settles motion. Alt+Up/Down and touch long-press work; swipes scroll, search disables reorder.

Workspace uses published Dialog/Card/theme, independent desktop columns with no batch rebalance, fixed search and sole results scroller; narrow one column/44px. Pins participate in search; directory cards own unpinned loading/New. One owner moves rows preserving focus/waves. Selection clears obstructing filter, expands only needed group/batch and scrolls; unpin expands destination before focus transfer. Mobile reveal waits for reopened drawer; background updates never scroll.

## Stable presentation and convergence
Key rows by ThreadID/labels separately. Publish each summary batch once under revision/title rules; retain focus/menus/waves.

# Boundaries

[Storage](../ai/flower-storage-ownership-and-migrations.md) owns upgrades; [read state](flower-read-state.md) owns acknowledgement. Detail success proves no seen content.

# Evidence

FlowerThreadList.directory.browser.test.tsx covers native pointer/touch/cancel/disclosure/focus/pins/locales/persistence, both painted label layers, breakpoint resize and interrupted selection; FlowerSurface.mobile covers deferred reveal. check_flower_sidebar_responsiveness.mjs verifies production Electron compact native/painted labels, motion/minification/reduced motion/resize/one save/content/no extra fetch. check_flower_directory_persistence.mjs verifies restart and ephemeral partitions. Context-action browser/Electron checks cover immediate menus/edit/exact copy; runners clean owned resources.
