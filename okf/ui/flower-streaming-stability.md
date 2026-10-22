---
type: UI Contract
title: Flower streaming stability
description: Incremental Markdown and local record updates preserve interactive identity.
tags: [flower, streaming, performance, interaction]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower renders actor-native changes through the indexed ThreadCache and the published Floe incremental Markdown parser. Ordinary growth changes the affected text/DOM region only. Stable history, code colors, copy controls, focus, selection and disclosure choices remain intact. A semantic change must remain visible; malformed updates recover through the single [live-state boundary](flower-live-timeline.md), never by omitting output or substituting a second lifecycle.

# Contract

## Local data and rendering
A snapshot initializes indexed item/message records once.

Obsolete JSON signature helpers and their signature-only tests are removed; projection tests assert canonical public fields directly. Actual removal transfers focus to an available adjacent action or composer unless navigation already moved it.

## One Markdown parser
Released Floe `createIncrementalMarkdownParser` owns Marked, CJK and GFM syntax. Reset establishes a source baseline; append returns explicit changed blocks, inline regions or text appends; finish performs the authoritative complete parse and necessary correction.

See [code highlighting](flower-code-highlighting.md) and [inline media](flower-inline-media.md).

## Disclosure and layout
Composer autosizing and approval measurements listen to releasable font loading completion/error events. Disposal removes those listeners; an unsettled FontFaceSet.ready promise must never retain a detached surface.

Companion reads the newest relevant record and bounds its normalized Unicode output tail instead of scanning historical messages or formatting the complete growing answer.

## Interaction cadence and resources
One bounded frame queue applies native updates in order inside the host's reactive batch.

Copy timers start only on explicit copy and reset after 1.6 seconds; clipboard failure never reports success.

The opt-in real-Service qualifier builds the production renderer, freezes historical content and provider cadence, and records cumulative runtime plus all Electron process CPU, frame/input/click/output latency, allocations and wire bytes. It verifies canonical provider content and rendered content after timing.

The task's explicit CPU, latency, allocation, transfer and long-task thresholds are hard gates, separate from ordinary CI and the bounded main pre-push gate.

# Boundaries

Floret remains the runtime/persistence owner; Floe owns generic parsing; Redeven owns product projection and DOM adapters. Failures keep drafts and visible content usable, with explicit retry and navigation.

# Evidence

- [Indexed record tests](../../internal/flower_ui/src/runtimeThreadRecord.test.ts)

- [Reactive record tests](../../internal/flower_ui/src/runtimeThreadRecord.client.test.ts)

- [Incremental model and semantic differential tests](../../internal/flower_ui/src/chat/markdown/streamingMarkdownModel.test.ts)
