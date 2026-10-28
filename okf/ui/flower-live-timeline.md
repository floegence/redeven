---
type: UI Contract
title: Flower incremental live state
description: One workspace facts stream, two bounded reading interests, and one indexed ThreadCache.
tags: [ui, flower, live, threads]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-28"
quality_exception: Cross-boundary live-state contract spanning stream ownership, bounded reading interests, delivery and body caching, immediate send feedback, and recovery inside one timeline concept.
---
# Summary

Floret owns canonical history, identity and versions. Redeven authorizes public
projection; one workspace stream delivers it to ThreadCache. Text growth changes
one item at its UTF-8 offset, never copying, scanning or encoding complete history.
Window loss refreshes that reading interest; transport loss uses the existing
connection owner. Both preserve execution, accepted prose and drafts.

# Contract

## Initialization

ThreadFactsSource.SubscribeFacts supplies account/workload/Computer/workspace facts without bodies or viewers. Root and child own independent authorized ThreadWindowSource interests. One worker coalesces ≤64 dirty parents without blocking the facts pump; [adapter ownership](../ai/floret-redeven-adapter-and-projection.md) applies.

Register observation before freezing authorized roots in navigation order. Release budgeted IDs/backing arrays as pages drain. Ready publishes observer identity, then ≤25-summary pages; only the last carries baseline_complete, followed by private read states. Accepted reading bypasses sidebar preparation; ordinary facts wait. Cancellation releases subscribers/queues without Next. Canonical failures invalidate observation; no arbitrary timeout or skipped pinned roots.

Merge pages immediately; prune only on completion, retaining selection/local creations. First page, confirmed empty inventory or accepted selected detail admits the surface; partial empty Ready does not. Explicit HTTP refresh uses cancellable 25-row pages, ten seconds per progressing page, retaining delivered pages on failure. Desktop cancels history/item POSTs. [Startup](../architecture/flower-startup-presentation.md) owns display.

## Windows and reading

Ready installs the current observer baseline before shared foreground loading. Covered responses coalesce demand; explicit command confirmation stays forced. Navigation/disposal/transport changes cancel obsolete waiters. Reconnect binds new-observer reads without losing content, scroll or drafts.

Root/child slots have independent monotonic revisions. Baselines/deltas share a subscription; page replacement fences older interest revisions. Limits:

| Read | Bound |
| --- | --- |
| Initial | 50 items, 1 KiB text previews, Activity summaries, existing byte budget |
| Earlier/newer | 150 items, 512 KiB |
| Window POST | 64 KiB JSON, 150 identities |
| Body/item locator | 8 KiB |
| Exact membership | 448 KiB canonical previews, excluding hydrated bodies |

Selection charges max(transmitted bytes, original window_bytes). Receipts refresh the accepted interval, never force Latest. Network interest is independent of retained reading. Keep visited sealed owners/bodies on the confirmed path and mounted visible/focused/selected live islands; evict inactive documents whole. Gap reads stop at missing intervals; prefetch stays ahead of the reading edge. One coalesced input demand owns each handoff, including stationary-edge input. HTTP/layout completion cannot recursively walk collapsed history. Failed navigation retains drafts/content and localized Retry.

Publish bounded windows without completing turns for counts. Exact sequence statistics require both boundaries plus complete intervening items/events; running groups may qualify. Otherwise show only localized Consecutive tool calls. Statistics never request history, receipts or bodies. Receipt alignment reads ≤one preview page per displayed span; gaps remain scroll demand. [Tool sequences](flower-tool-sequences.md) owns presentation.

Foreground readers own publication; live baselines queue during handoff. Reuse only a confirmed preceding cached prefix matching sealed ID, kind, turn/run, ordinal and canonical ordinal; old windows cannot infer new ends. Pagination retains manual disclosure through anchor changes/navigation and preserves focused/selected canonical DOM.

Collapsed patches use summary name/type for one mutation or localized multi-file count, with no details or invented targets/diff rows. Expansion retains titles, totals and file statistics. Activity summaries carry shape/counts/scalars/small values without field locators; explicit structure/value reads use authorized frozen sources, without storage/index/migration changes.

## Bodies and incremental transport

Only unseen text shows skeletons. Accepted prose, attachments/references, anchors and follow choices survive refresh/completion. One visibility observer admits demand within 160 px; text/open tools share two slots and a 15-second deadline. Priority: visible live text/interactive disclosure, visible history, background; age every eight admissions. Offscreen/navigation cancels demand/read; failures expose local Retry.

ThreadCache alone retains bodies by item/turn/run/source. Freshly authorized ThreadItemTextReader reads ≤16 KiB at accepted UTF-8 offsets. One source task coalesces extents, accepts earlier in-flight prefixes and yields between chunks. No polling, full-prefix/history downloads or duplicate store. Changed sources, including sealing, restart at canonical preview offset; live/sealed suffixes need not match. Keep readable prose until replacement chunks complete, then publish once. Same-source refresh retains progress; late old chunks cannot overwrite. A retired live locator is an explicit source_changed response only after published Floret ItemBody confirms the same item now has a canonical source. Its read releases its slot and waits for authoritative observation, without polling, guessing canonical offsets or suppressing unrelated read errors. Terminal/exhausted failures offer localized Retry, never execution replay.

Ending a text segment (`live: false`) does not itself change its source. A longer validated same-source live preview advances cached text and pending state atomically, preserving the locator for later growth. Covered chunk responses validate their overlap and yield without layout invalidation; any missing suffix resumes at the current cache offset. Source changes discard obsolete responses. Response/request identity, range, conflicting prefixes and empty nonterminal chunks remain explicit failures. Regression tests control both completion orders and overlapping reads, retaining the bubble, draft, focus and geometry while the turn continues through tools.

Schema v3 has one decoder. Base64 fragments include identity, zero-based index/count and total bytes. Merge ≤32 KiB fragments only with matching revision/thread/item/turn/run, contiguous version and UTF-8 offset. Growth sends locators. Same-source server/frame coalescing uses constant storage, original base version and intact semantic boundaries. Limits: sixteen pending batches, 32 MiB envelope/subscriber, 32 MiB global retained references. Started frames are immutable; byte-accounted covered versions suppress represented deltas. Summary/private-state/child inventories use separate mailboxes.

Pending controls are page-independent. Authorized server-only 64-item pages read Computer safety facts from pending turns to their user boundaries; confirm leaf/version, use individual reads for oversized collections. No full View/history body. Missing authority or broken ordering invalidates observation.

## Layout and retention

Measured offscreen sections retain DOM/intrinsic height while skipping layout. Long active turns split after prose near 24 rows, keeping consecutive tool/thinking sequences together and existing section/row owners stable across prepend. Visible, live, focused and selected sections retain layout; canonical content and disclosure owners remain accessible. Token growth updates per-block content presence only at empty/nonempty transitions; equal timeline and turn projections retain their identities. Mounted keyed subscriptions publish only changed section, entry, sequence and process facts and release with their Solid owners. Turn-end timestamps and final-answer ownership use keyed subscriptions too. Structural projectors read immutable record fields without allocating per-field reactive subscriptions; sealing through structural replacement, content-presence boundaries and preview replacement remain observable. Expired title arrivals do not revisit historical disclosure state. Thinking appends retain block identity. Membership checks use sets; empty receipt coverage does not republish on leaf-only changes. Following the latest output does not scan historical rows for a reading anchor. Inspection retains disclosure/nested offsets; Fork does not inherit another thread's manual choices. Unchanged sections/projections retain identity. One scroll owner corrects anchors before paint for growth, stationary-edge input and placeholder/summary replacement; readiness notification remains independently scheduled.

Cold sealed text stages complete bounded chunks in its item record across reconnect. Publish complete Markdown at final geometry, without entrance height animation or partial table/list/code formatting; retain visible prose during replacement and incremental live growth. Root/child navigation suppresses arrival scrolling until positioned/revealed. Cache accounting visits raw objects once, without recursive reactive unwrapping/subscriptions.

Compaction decorations follow visible anchors and the active run's latest operation; paging restores historical decorations without removing model history. Inactive detail budget: twelve threads or 32 MiB estimated bytes; summaries survive. Selected/retained/in-flight owners are protected. Append logs: 256 chunks/256 KiB with absolute cursors and exact-source catch-up. Active documents/selection are not capped.

History and terminal catch-up share one floating notice after 200 ms; fast reads mount nothing, publication is immediate, overlapping work adds no duplicates. [Command/composer ownership](flower-turn-launcher.md) retains immediate captured input and request-key DOM through admission, separating SendAck from windows.

## Recovery

One detail loader retries complete preparation/baseline after 200/600/1200 ms, ≤four attempts inside fifteen seconds. New revisions discard unpublished pages/envelopes. Leaf drift is recoverable; foreign threads/malformed ordering are terminal. Navigation/disposal/connection changes cancel reads/backoff. Success adds no read/timer. Preserve DOM/drafts/scroll; exhausted refresh uses interrupted-sync Retry, distinct from first-load failure. Never replay commands.

history_invalidated permits one bounded automatic read per selection/manual action; repeated loss offers Retry. Release cancels installed/pending interest without waiting for reads; child closure releases its slot only. One-shot windows cannot inherit old membership.

Transport loss/handshake deadlines/gaps use the existing bounded backoff owner. Final disposal aborts without reactive/cache publication into teardown; reconnect publishes its boundary. Activity observers attach after DOM adoption and detach with rows. Authorization/capacity/version/malformed-contract failures are terminal. Classify fetch/bridge errors before mapping; mapper exceptions do not retry. Diagnostics expose category/status/epoch, never bodies/arbitrary messages. SSE loss=503, baseline timeout=504, invalid request=400, capacity=429. Unknown results retain request keys; disconnect cannot replay effects.

One pointer-local floating stack owns connection/unconfirmed/settings/initial/detail/history/parent-report/navigation feedback. It takes no transcript height; collapsed companions float above the editor. Loading uses four sidebar wave bars, localized live status and reduced motion. Errors retain explanation/actions; terminal connection failure offers Resync. Notices cannot overlap; composer omits duplicates and preserves progress height. Canonical activity/cancellation owns Stopping. Read one canonical summary; viewer/current-only events cannot invent coverage. [Approval/input](flower-approval-context.md), [read state](flower-read-state.md) and [process disclosure](flower-turn-process-disclosure.md) own policy.

# Boundaries

Streams, queues and cache are bounded ephemeral observation, never durable cursors
or another lifecycle. Database kinds and all released migration edges remain.

Explicit wheel, touch or keyboard intent can page from canonical history-window edges even when every loaded body is folded and no message anchor is visible. A visible message is only a layout anchor, never an admission requirement for paging. One coalesced input demand reads one bounded page; completion and idle layout cannot recursively traverse collapsed history.

# Evidence

- [Electron startup](../../desktop/scripts/check-flower-startup.mjs) and [localized navigation](../../desktop/scripts/check-flower-navigation.mjs): partial/final baselines, selection, drafts, one stream, no duplicate list scan, owned cleanup.
- [Floating notice geometry](../../internal/envapp/ui_src/src/ui/FlowerSurface.floatingNotices.browser.test.tsx) and [localized recovery](../../internal/envapp/ui_src/src/ui/FlowerSurface.syncStatus.browser.test.tsx) cover new-chat loading/failure/retry, narrow layouts, keyboard recovery and unchanged transcript/composer bounds.
