---
type: UI Contract
title: Flower activity disclosure interaction
description: Keep native tool activation, disclosure state, viewport following, and floating controls consistent during live updates.
tags: [ai, flower, activity, interaction, accessibility]
timestamp: 2026-10-19T00:00:00Z
quality_exception: One 12,163-character Activity interaction contract retains the inseparable native disclosure, safe-result, viewport, and gesture ownership invariants; placement and tool-sequence behavior remain in separate concepts, and strict quality still enforces the 20,000-character maximum.
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower owns activity interaction in its shared UI. Canonical Floret identity and
presentation remain the only execution facts. Each transcript has one viewport
controller for follow intent, user input, temporary anchoring, and position
writes. A live update must not move a pressed tool trigger or introduce a
floating hit target before its native click completes. Canceled gestures never
activate tools. All transient ownership ends when its view is disposed.

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
Tool sequence scroll chaining follows the [sequence reading contract](flower-tool-sequences.md#disclosure-and-reading): short groups and outward input at a sequence edge reach the transcript, while embedded terminals and editors retain their own input.

Hidden controls do not enter the focus or hit-test order.

## Visual motion
The disclosure motion owner uses one current Web Animation: opening takes 180 ms and closing takes 140 ms. Reversal cancels the prior animation, and its obsolete completion cannot change presence.

New tool, argument-preview and thinking titles in a confirmed active transcript
use a short stepped text reveal. The complete text and fixed row geometry are
present immediately, including accessible names, selection and click targets.
Only the title is visually clipped; runtime delivery, results, durations and
disclosure controls never wait for animation. The reveal takes 168–360 ms,
adapting to visible width with at most 32 steps. Concurrent arrivals do not queue;
each transcript retains at most 12 animations and shows older burst titles fully.

The transcript owns transient arrival claims only for the current execution.
Initial history, conversation switches, reconnect baselines, hidden disclosures,
and arrivals first mounted more than 450 ms later remain static. A title is
claimed once across preview promotion and disclosure remounts. Failures and
approval requests appear immediately. Content/status changes, navigation,
disposal, a hidden document or enabling reduced motion remove active clipping.
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
