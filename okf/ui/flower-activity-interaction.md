---
type: UI Contract
title: Flower activity disclosure interaction
tags: [ai, flower, activity, interaction, accessibility]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Desktop and Env App render canonical Floret facts with one transcript viewport owner. Live updates cannot move pressed triggers or insert hit targets before click completion. Canceled gestures activate nothing; disposal releases gesture ownership while retained content stays inspectable.

# Contract

## Content and identity
Permanent folding gutter aligns prose/activity/progress/Goal before grouping. Details align with summary; tool/thinking metadata follows text with compact gap/full-row activation. Chevrons derive right/down solely from aria-expanded, including initially open screenshots.

Identity=thread/run/turn/canonical item. [Sequences](flower-tool-sequences.md) groups tools/thinking; individual details stay accessible. Collapsed fields preserve intent/result shape without hidden payload. Disclosure reads selected values:16KiB chunks/128KiB windows with selection pins. Close/hide/navigation cancels. Markdown keeps exact UTF-8/whitespace, yields between batches, and retains complete selected working set rather than fixed preview.

Thread Query:/Thread Read: remain technical labels with model intent in user language; [queries](../ai/flower-thread-queries.md) owns privacy/limits/failures. Web search uses one localized visible/accessibility title; details show actual per-call results/errors, including URL-only sources, without repeated query/URL/pattern/status.

Registered/hosted/source/MCP/unknown tools share compact glyphs/leading edge with prose/progress. Composer/status shares native scrollbar gutter. Existing resize observer reads only inline-size changes; existing layout scheduler publishes changed geometry. Row growth adds no width reads/observers/schedulers; embedded hosts retain ownership. Collapsed titles describe intent, never supply input/authority. Computer tools omit absent-observation filler but retain typed failures, uncertainty, blank pages and unavailable targets.

## Observation interruptions
TARGET_OBSERVATION_UNAVAILABLE keeps canonical error/completed actions, but visible/accessibility copy says page read unavailable, distinguishing confirmed effects. Unknown effects/user decisions retain attention. Keyboard technical disclosure keeps original message/code. Published ActivityError.Code and bounded computer_observation=unavailable chips retain category without hidden-body reads. Exclude these interruptions from group/turn failure counts; all other errors stay failures. Never infer old records from English, rewrite history, mark recovered from unrelated success or auto-retry.

## Viewport/input
One controller owns position; layout/focus/motion/growth cannot resume paused reading. [Sequence geometry](flower-tool-sequences.md#geometry-and-input) owns native nested scroll/inert controls; [SubAgents](flower-subagent-detail.md) owns child viewport.

Prose continuously approaches actual bottom; chunks retarget without restart. One line settles≈160ms with fractional positions/no overshoot. Share one geometry frame; motion-only frames reuse measurements and skip history scans until settled scroll. No idle polling/delayed output. Native input/selection pauses immediately; clearing selection does not resume. Initial positioning/navigation/resize/shrink are immediate. Explicit latest arrives220ms; automatic folds follow real content without trailing space/competing scroll. Exclude paused insertion room from latest distance. Reduced motion skips; hide/rebind/dispose cancels.

## Thinking and motion
Canonical first/last chunk receipts survive hydration/reconnect/restart/Fork. Continuation reopens interval, last chunk ends it. Tooltip distinguishes receipt vs compute; show<1ms/localized Not recorded, never infer neighbors/totals. Legacy observations remain memory-only.

Live petals fill clockwise then center, hold/fade2.4s. Sealed/canceled/disconnected static; CSS handles theme/reduced-motion/high-contrast/forced colors without lifecycle. Disclosure uses one reversible Web Animation,180ms open/140ms close, stale completions ignored. [Sequence handoff](flower-tool-sequences.md#disclosure-and-bodies) owns260ms geometry/crossfade/stationary prose.

Fresh tool/argument/thinking titles reveal once168–360ms,<=32 width-adapted steps; full text/geometry/accessibility/actions exist immediately. After sequence placement, make viewport room220ms before reveal; growth retargets without extending deadline. Scroll interrupts, paused reading remains; reduced motion skips. Delivery/results/controls never wait. Independent arrivals/shimmer preserve typography.

Accepted receipt/selection provenance gates execution arrivals. History/body restore/queued reads consume claims and settle statically; post-ready live snapshots/deltas qualify. Two visible receipts retain only restore revision/live flag, no copy/scheduler/timer/row observer. Claims exclude navigation/reconnect/hidden disclosure/>450ms delayed mounts; observe closure before lazy mount and survive preview promotion/remount/replacement/completion. Final snapshots may reveal new tools from previously active execution.

Auto-fold awaits admitted title motion then reading protection. New prose awaits sequence close; manual actions/delivery immediate. Title node survives trigger change, call identity transfers remaining time. Failure/approval immediate. Navigation/dispose/hide/reduced motion clears clipping; no character timers/per-frame reactive state/durable animation facts.

# Boundaries

Presentation creates no Floret API/lifecycle, reconstructed input or file/process/approval authority. Transport continues during interaction.

# Evidence

- [Viewport](../../internal/flower_ui/src/flowerScrollTail.ts), deterministic frame/input tests and [streaming](../../internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx): bounded layout, burst retargeting, displacement, text identity/selection, reduced motion/cancel.
- `redeven:internal/ai/tool_activity_details.go` - Source.
- `redeven:internal/ai/computer_activity.go` - Source.
- `redeven:internal/flower_ui/src/FlowerActivityRows.tsx` - Source.
- [Title owner](../../internal/flower_ui/src/flowerActivityTitleReveal.ts)/[browser](../../internal/envapp/ui_src/src/ui/FlowerSurface.activityTyping.browser.test.tsx): arrival,geometry,history,navigation,preferences,cleanup.
- [Thinking](../../internal/flower_ui/src/FlowerThinkingDisclosure.tsx)/[petal browser](../../internal/envapp/ui_src/src/ui/flower/FlowerThinkingIcon.browser.test.tsx): order/timing/all themes/reduced motion/forced colors.
