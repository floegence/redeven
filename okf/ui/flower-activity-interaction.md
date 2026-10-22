---
type: UI Contract
title: Flower activity disclosure interaction
description: Keep native tool activation, disclosure state, viewport following, and floating controls consistent during live updates.
tags: [ai, flower, activity, interaction, accessibility]
timestamp: 2026-10-19T00:00:00Z
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

Hidden controls do not enter the focus or hit-test order.

## Visual motion
The disclosure motion owner uses one current Web Animation: opening takes 180 ms and closing takes 140 ms. Reversal cancels the prior animation, and its obsolete completion cannot change presence.

[SubAgent detail](flower-subagent-detail.md) owns child grouping and projection; its viewport controller cannot affect the parent transcript.

# Boundaries

This is Flower presentation policy, not a Floret public API or another execution lifecycle. Host-rendered safe details cannot reconstruct tool input or authorize file, process, or approval actions. Live transport continues during interaction.

# Evidence

- `redeven:internal/ai/tool_activity_details.go` - Bounded product input/result mapping over the released Floret contract.

- `redeven:internal/ai/computer_activity.go` - Candidate and semantic page facts without redundant status or platform details.

- `redeven:internal/flower_ui/src/FlowerActivityRows.tsx` - Published code display, localized copy feedback and stable row expansion.
