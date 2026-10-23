---
type: UI Contract
title: Flower activity disclosure interaction
description: Keep native tool activation, disclosure state, viewport following, and floating controls consistent during live updates.
tags: [ai, flower, activity, interaction, accessibility]
timestamp: 2026-10-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Shared Flower UI uses canonical Floret facts and one transcript viewport owner.
Live updates cannot move pressed triggers or add hit targets before clicks finish.
Canceled gestures never activate tools; disposal releases transient ownership.
Desktop and Env App share this contract.

# Contract

## Stable disclosure and safe content
Activity identity uses thread, run, turn, and canonical item ID.

Consecutive tools and bounded thinking use [tool sequences](flower-tool-sequences.md) for compact spacing and group disclosure, without replacing individual details.

## Thread query and read details
`Thread Query:` and `Thread Read:` are fixed English technical tool labels; their suffix preserves the model-authored invocation intent in the user's language. See the [thread query contract](../ai/flower-thread-queries.md) for canonical lookup, privacy, server bounds and failure behavior.

## Web search details
Web operations use one localized action title for visible and accessible labels.

Expanded details contain only actual per-call results and errors, never the header's query, URL, pattern or status.

Floret v7.44.1 preserves URL-only sources through validation and canonical restart.

## Semantic tool icons
Collapsed rows retain their compact geometry. Each registered tool, the hosted web-search activity, source activity, MCP extension, and unknown extension has an explicit type glyph.

Both Desktop and Env App consume the same component.

## Intent, inputs and results
The collapsed title describes the invocation intent. Actual outcomes never replace the invocation intent.

Presentation never supplies execution input or authorization.

## Viewport and gesture ownership
One controller per viewport owns transcript position. Layout, focus, animation and growth never resume a reading pause.
Thinking, tool sequences and read-only detail previews follow the [sequence reading contract](flower-tool-sequences.md#disclosure-and-reading). Short regions and outward input at every nested edge reach the next scrollable ancestor. Transcript follow intent matches this native chain; explicitly contained regions and canceled input remain local.

Hidden controls do not enter the focus or hit-test order.

## Thinking duration
Floret v7.81.0 owns first/last chunk-receipt times per output source. Flower
projects the public DTO into its message cache; cold history, hydration,
reconnect, restart and Fork preserve the interval without live UI observation.
Canonical timing replaces page observations. Native continuation reopens it;
completion ends at the last chunk, not delivery, tool completion or commit.
The tooltip distinguishes received-output time from provider compute time.

Measured intervals below 1ms display <1ms. Missing history shows localized
Not recorded with an explanation; neighboring events and turn totals never
supply timing. Older page observations remain only in the existing memory cache,
without another store.

## Visual motion
Confirmed live thinking uses a 2.4-second cycle: five petals fill clockwise from
their bases and retain color; the cream-gold center fills last, then all hold
and fade. Titles reveal once, then shimmer while live. Sealed, cancelled and
disconnected rows remain static. Theme tokens color petals and outlines; the
light center covers its empty outline without a halo. Reduced motion shows a
filled static flower; high contrast uses solid fills; forced colors use system
colors and an outlined center. CSS follows disclosure liveness without timers
or extra state.

The disclosure motion owner uses one current Web Animation: opening takes 180 ms and closing takes 140 ms. Reversal cancels the prior animation, and its obsolete completion cannot change presence.

New tool, argument-preview and thinking titles in a confirmed active transcript
reveal in 168–360 ms with at most 32 width-adapted steps. Full text, fixed geometry,
accessible names, selection and click targets exist immediately. After sequence
placement, existing viewport owners make room over 220 ms before row fade/reveal;
rows never flash at their old position. Growth retargets without extending the
deadline. Reading stays paused; user scrolling interrupts; reduced motion skips
scrolling animation and reveal. Delivery, results and controls never wait.
Concurrent arrivals neither queue nor evict each other. Running titles start
glyph-only shimmer after reveal; fast results finish revealing without shimmer.
Typography stays fixed across that handoff.

The transcript owns transient arrival claims only for the current execution.
Initial history, conversation switches, reconnect baselines, hidden disclosures,
and arrivals first mounted more than 450 ms later remain static. A title is
claimed once across preview promotion and disclosure remounts. Arrival claims
observe sequence disclosure before lazy content mounts, so opening a sequence
does not animate rows received while it was folded. New tools in the final
snapshot of a previously active execution still receive their reveal. Runtime
snapshot replacement, content updates and completion never cancel an admitted
title reveal. Automatic turn and sequence folding waits for these active title
animations, then resumes its existing reading-protection policy. Manual folding
and final replies remain immediate. The title node survives static-to-expandable trigger changes;
preview promotion transfers the same animation and remaining time by call
identity. Failures and approvals expose status and actions immediately while
the title finishes. Navigation, disposal, a hidden document or enabling reduced
motion remove active clipping.
There are no character timers, per-frame reactive updates, persisted animation
facts or runtime changes. Desktop and Env App use the same implementation.

[SubAgent detail](flower-subagent-detail.md) owns child grouping and projection; its viewport controller cannot affect the parent transcript.

# Boundaries

This is Flower presentation policy, not a Floret public API or another execution lifecycle. Host-rendered safe details cannot reconstruct tool input or authorize file, process, or approval actions. Live transport continues during interaction.

# Evidence

- `redeven:internal/ai/tool_activity_details.go` - Bounded product input/result mapping over the released Floret contract.

- `redeven:internal/ai/computer_activity.go` - Candidate and semantic page facts without redundant status or platform details.

- `redeven:internal/flower_ui/src/FlowerActivityRows.tsx` - Published code display, localized copy feedback and stable row expansion.

- [Title reveal owner](../../internal/flower_ui/src/flowerActivityTitleReveal.ts)
  and [browser regression checks](../../internal/envapp/ui_src/src/ui/FlowerSurface.activityTyping.browser.test.tsx)
  cover concurrent arrival, geometry, history, navigation, motion preferences and cleanup.

- [Thinking disclosure](../../internal/flower_ui/src/FlowerThinkingDisclosure.tsx) and
  [petal animation browser checks](../../internal/envapp/ui_src/src/ui/flower/FlowerThinkingIcon.browser.test.tsx)
  cover fill order, timing, every shipped theme, reduced motion and forced colors.
