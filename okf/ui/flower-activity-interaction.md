---
type: UI Contract
title: Flower activity disclosure interaction
description: Keep native tool activation, disclosure state, viewport following, and floating controls consistent during live updates.
tags: [ai, flower, activity, interaction, accessibility]
timestamp: 2026-10-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Shared Flower UI uses canonical Floret facts and one transcript viewport owner.
Live updates cannot move pressed triggers or add hit targets before clicks finish.
Canceled gestures never activate tools; disposal releases transient ownership.
Desktop and Env App share this contract.

# Contract

## Stable disclosure and safe content
The permanent left folding-rail gutter aligns prose, activity and progress before groups form. Goal history icons share the prose/tool leading edge; their expanded text aligns with the summary label. Individual tool and thinking metadata/disclosure controls follow the text tail with the same compact gap, retaining the full-row activation area. Tool disclosure chevrons point right when collapsed and down when expanded, including initially open screenshots; CSS reads the trigger’s existing `aria-expanded` state without a second state owner.

Activity identity is thread, run, turn and canonical item ID. [Tool sequences](flower-tool-sequences.md) own grouping and bounded thinking; individual details remain available.

Field summaries preserve collapsed labels and result shape without transferring hidden payloads. Disclosure reads selected values; long text uses 16 KiB ranges and a 128 KiB reading window, with explicit selection pins. Closing, hiding or navigating cancels obsolete demand. Markdown reads exact UTF-8 chunks and yields between batches: whitespace cannot be sampled or silently removed because it affects parsing and copied code. A selected Markdown document remains a complete working set rather than a fixed-memory preview.

## Thread query and read details
`Thread Query:` and `Thread Read:` are fixed technical labels; their suffix retains model-authored intent in the user's language. [Thread queries](../ai/flower-thread-queries.md) own lookup, privacy, bounds and failure behavior.

## Web search details
Use one localized action title for visible and accessible labels. Expanded details show actual per-call results/errors, including URL-only sources, without repeating header query, URL, pattern or status.

## Semantic tool icons
Shared Desktop/Env App rows retain compact geometry and explicit glyphs for registered tools, hosted web search, sources, MCP and unknown extensions.

Tool/thinking icons, prose and the full/companion progress lane share one left edge. The composer/status column uses the transcript's native scrollbar gutter. Its existing resize observer reads gutter width only when viewport inline size changes; the existing scheduled layout phase publishes changed geometry. Row growth adds no width reads, observer or frame scheduler. Embedded hosts retain their own status/composer layout.

## Intent, inputs and results
Collapsed titles describe invocation intent, never substituted outcomes. Presentation cannot supply execution input or authorization. BrowserUse/ComputerUse rows omit absent-observation filler; typed failures, uncertain effects, blank pages and unavailable targets retain their meaningful status.

## Viewport and gesture ownership
One viewport controller owns transcript position. Layout, focus, animation and growth cannot resume paused reading. [Sequence reading](flower-tool-sequences.md#disclosure-and-reading) owns native nested scrolling; hidden controls are neither focusable nor hit-testable. [SubAgent details](flower-subagent-detail.md) have an independent viewport.

Transcript and SubAgent prose growth continuously approaches the current bottom;
new chunks retarget without restarting the motion. A single line settles in about
160 ms, with fractional position retained and no overshoot. Geometry changes
share one scheduled frame; animation-only frames reuse measured geometry and
skip history scans until the settled scroll event. No idle polling or delayed
output delivery. Native scroll input and text selection immediately pause follow;
clearing selection does not resume it. Initial positioning, navigation, viewport
resize and shrinking ranges remain immediate. Explicit return keeps its 220 ms
arrival motion; automatic folds follow real content geometry without trailing
space or a competing scroll animation. Paused-reading room is excluded from
distance to latest, keeping explicit return reachable. Reduced motion bypasses
animation, and hiding, rebinding or disposal cancels obsolete motion.

## Thinking duration
Floret's canonical first/last output-chunk receipt times survive hydration, reconnect, restart and Fork. They replace page observations; native continuation reopens the interval and completion ends at the last chunk. Tooltips distinguish received output from provider compute time. Show <1ms below one millisecond and localized Not recorded when absent; never infer timing from neighboring events or turn totals. Legacy page observations remain memory-only.

## Visual motion
Confirmed live thinking fills five petals clockwise, then its center, holds and fades over 2.4 seconds. Sealed, cancelled and disconnected rows are static. Theme tokens, reduced motion, high contrast and forced colors own accessible variants; CSS needs no separate lifecycle. Disclosure uses one reversible Web Animation (180 ms open, 140 ms default close); stale completions cannot change presence. Shared tool/turn handoffs use the [sequence motion contract](flower-tool-sequences.md#disclosure-and-bodies): one 260 ms geometry owner, composited summary crossfade and stationary prose arrival.

Fresh tool, argument-preview and thinking titles reveal once over 168–360 ms, at most 32 width-adapted steps. Full text, geometry, accessible names and actions exist immediately. After sequence placement, viewport owners make room over 220 ms before reveal; growth retargets without extending the deadline. User scrolling interrupts; paused reading stays paused; reduced motion skips animation. Delivery, results and controls never wait. Concurrent arrivals remain independent; running glyph shimmer starts after reveal without typography changes.

Execution-scoped arrival claims exclude history, navigation, reconnect baselines, hidden disclosures and mounts delayed beyond 450 ms. Claims observe sequence closure before lazy mount and survive preview promotion, disclosure remount, snapshot replacement and completion. A final snapshot may reveal new tools from the previously active execution. Automatic folding waits for admitted title animations and then applies reading protection; a newly arriving prose block waits for its [sequence's closing motion](flower-tool-sequences.md), while runtime delivery and manual actions remain immediate. The title node survives trigger changes; call identity transfers remaining animation time. Failure/approval actions are immediate. Navigation, disposal, hidden documents and reduced motion clear clipping. No character timers, per-frame reactive state or persisted animation facts.

# Boundaries

This is Flower presentation policy, not a Floret public API or another execution lifecycle. Host-rendered safe details cannot reconstruct tool input or authorize file, process, or approval actions. Live transport continues during interaction.

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
