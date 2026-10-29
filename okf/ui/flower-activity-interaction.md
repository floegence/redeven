---
type: UI Contract
title: Flower activity disclosure interaction
tags: [ai, flower, activity, interaction, accessibility]
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Desktop and Env App share canonical Floret facts and one transcript viewport owner. Live changes cannot move pressed triggers/add hit targets before click completion. Cancelled gestures never activate tools; disposal releases all transient gesture ownership.

# Contract

## Stable disclosure and safe content

Permanent folding-rail gutter aligns prose/activity/progress before grouping. Goal icons share that edge; expanded text aligns to summary. Tool/thinking metadata and disclosure follow text with a compact gap and full-row activation. Chevrons read existing aria-expanded: right closed/down open, including initially open screenshots; no second state owner.

Identity is thread/run/turn/canonical item ID. [Sequences](flower-tool-sequences.md) own grouping/bounded thinking; individual details remain available. Collapsed field summaries preserve intent/result shape without hidden payload. Disclosure reads selected values; long text uses 16 KiB ranges/128 KiB reading windows with explicit selection pins. Close/hide/navigation cancels demand. Markdown reads exact UTF-8 chunks and yields between batches, never sampling/removing meaningful whitespace. Selected Markdown remains a complete working set, not fixed-memory preview.

## Thread query and read details

Thread Query: and Thread Read: are fixed technical labels with model-authored intent in the user's language. [Queries](../ai/flower-thread-queries.md) owns privacy, lookup, limits and failures.

## Web search details

One localized visible/accessibility action title. Expanded details show real per-call results/errors, including URL-only sources, without repeating header query/URL/pattern/status.

## Semantic tool icons

Compact shared rows provide glyphs for registered tools, hosted search, sources, MCP and unknown extensions. Tool/thinking icons, prose and full/companion progress share the leading edge. Composer/status uses transcript's native scrollbar gutter. Existing resize observer reads gutter only on inline-size changes; existing layout scheduling publishes changed geometry. Row growth adds no width reads/observer/scheduler. Embedded hosts retain layout ownership.

## Intent, inputs and results

Collapsed titles describe invocation intent, not outcomes; presentation cannot supply execution input/authority. BrowserUse/ComputerUse omit absent-observation filler but preserve typed failures, uncertain effects, blank pages and unavailable targets.

## Viewport and gesture ownership

One transcript controller owns position; layout/focus/motion/growth cannot resume paused reading. [Sequences](flower-tool-sequences.md#geometry-and-input) own native nested scrolling; hidden controls are inert. [SubAgent details](flower-subagent-detail.md) own their viewport.

Transcript/child prose continuously approaches current bottom; chunks retarget without restart. One line settles about 160 ms, retaining fractions without overshoot. Geometry shares one scheduled frame; animation-only frames reuse measurements and skip history scans until settled scroll. No idle polling/output delay. Native input/selection pauses follow immediately; clearing selection does not resume. Initial positioning/navigation/resize/shrinking are immediate. Explicit return uses 220 ms arrival; automatic folds follow actual content without trailing space/competing scroll. Exclude paused-reading room from distance to latest. Reduced motion skips animation; hide/rebind/disposal cancels obsolete motion.

## Thinking duration

Canonical first/last chunk receipt times survive hydration/reconnect/restart/Fork, replacing page observations. Native continuation reopens the interval; last chunk ends it. Tooltips distinguish receipt duration from provider compute. Show <1ms or localized Not recorded; never infer from neighbors/turn totals. Legacy observations stay memory-only.

## Visual motion

Live thinking fills five petals clockwise then center, holds/fades over 2.4 seconds. Sealed/cancelled/disconnected rows are static. Theme/reduced-motion/high-contrast/forced-color variants use CSS without another lifecycle. Disclosure uses one reversible Web Animation: 180 ms open/140 ms default close, ignoring stale completions. [Sequence handoff](flower-tool-sequences.md#disclosure-and-bodies) owns 260 ms geometry, composited summary crossfade and stationary prose arrival.

Fresh tool/argument-preview/thinking titles reveal once over 168–360 ms in at most 32 width-adapted steps. Full text/geometry/accessibility/actions exist immediately. After sequence placement, viewport makes room over 220 ms before reveal; growth retargets without extending deadline. User scroll interrupts; paused reading stays paused; reduced motion skips. Delivery/results/controls never wait. Arrivals are independent; glyph shimmer follows reveal without typography changes.

Accepted receipt provenance/selection preparation gates execution-scoped arrivals. History/body restoration and queued reading consume claims and settle folds statically; post-ready live snapshots/deltas remain eligible. Two visible timeline receipts retain only an in-memory restore revision/live flag, no transcript copy/scheduler/timer/row observer. Claims exclude navigation/reconnect baselines/hidden disclosures/mounts delayed beyond 450 ms. They observe closure before lazy mount and survive preview promotion/remount/snapshot replacement/completion. Final snapshots may reveal new tools from the previously active execution.

Auto-fold waits for admitted title motion then applies reading protection; new prose waits for sequence closure, while delivery/manual actions remain immediate. Title nodes survive trigger changes; call identity transfers remaining time. Failure/approval acts immediately. Navigation/disposal/hidden documents/reduced motion clear clipping; no character timers/per-frame reactive state/persisted animation facts.

# Boundaries

This is presentation policy, not a Floret API/execution lifecycle. Safe details cannot reconstruct inputs or authorize files/processes/approvals. Transport continues during interaction.

# Evidence

- [Viewport controller](../../internal/flower_ui/src/flowerScrollTail.ts),
  its deterministic frame tests, input-ownership tests and
  [streaming browser checks](../../internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx)
  cover bounded layout work, burst retargeting, frame displacement, text identity,
  selection, reduced motion and lifecycle cancellation.

- `redeven:internal/ai/tool_activity_details.go` - Bounded product input/result mapping over the released Floret contract.

- `redeven:internal/ai/computer_activity.go` - Candidate and semantic page facts without redundant status or platform details.

- `redeven:internal/flower_ui/src/FlowerActivityRows.tsx` - Published code display, localized copy feedback and stable row expansion.

- [Title reveal owner](../../internal/flower_ui/src/flowerActivityTitleReveal.ts)
  and [browser regression checks](../../internal/envapp/ui_src/src/ui/FlowerSurface.activityTyping.browser.test.tsx)
  cover concurrent arrival, geometry, history, navigation, motion preferences and cleanup.

- [Thinking disclosure](../../internal/flower_ui/src/FlowerThinkingDisclosure.tsx) and
  [petal animation browser checks](../../internal/envapp/ui_src/src/ui/flower/FlowerThinkingIcon.browser.test.tsx)
  cover fill order, timing, every shipped theme, reduced motion and forced colors.
