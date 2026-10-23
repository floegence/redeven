---
type: UI Contract
title: Flower streaming stability
description: Incremental Markdown and local record updates preserve interactive identity.
tags: [flower, streaming, performance, interaction]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Flower renders actor-native changes through the indexed ThreadCache and the published Floe incremental Markdown parser. Ordinary growth changes the affected text/DOM region only. Stable history, code colors, copy controls, focus, selection and disclosure choices remain intact. A semantic change must remain visible; malformed updates recover through the single [live-state boundary](flower-live-timeline.md), never by omitting output or substituting a second lifecycle.

# Contract

## Local data and rendering
A snapshot initializes indexed item/message records once.

Obsolete JSON signature helpers and their signature-only tests are removed; projection tests assert canonical public fields directly. Actual removal transfers focus to an available adjacent action or composer unless navigation already moved it.

## One Markdown parser
Released Floe `createIncrementalMarkdownParser` owns Marked, CJK and GFM syntax. Reset establishes a source baseline; append returns explicit changed blocks, inline regions or text appends; finish performs the authoritative complete parse and necessary correction.

Flower tracks the complete accepted source through appends. A changed snapshot establishes a complete parser baseline: unchanged list tokens can move to new source offsets and block identities. The DOM adapter reuses exact tokens at unchanged offsets and retires the other old regions before applying that baseline. Identical-source metadata changes retain existing regions. Completed answers preserve every authored block through tool-process collapse and later snapshot replacement.

See [code highlighting](flower-code-highlighting.md) and [inline media](flower-inline-media.md).

## Soft live text reveal

Newly appended prose fades into its current theme text color over 320 ms. The DOM
adapter paints exact added ranges through CSS custom highlights; it does not split
text nodes, delay delivery, translate lines, or restart the effect on already read
content. Initial history and corrected snapshots appear immediately. Headings,
lists and emphasis can reveal their added suffix; links, code, media and controls
keep their own colors and interaction behavior.

Twenty fixed CSS paint phases avoid document-wide stylesheet mutation on each
frame. Each active Markdown owner retains at most 32 transient range groups. Diff
inspection is limited to 8,192 characters and 128 text nodes per region; larger
replacements and bursts remain immediately readable. Completion never waits for
paint: remaining valid highlights settle naturally. Reset, unmount, hidden
documents, reduced motion and forced colors clear effects and their callbacks.
Historical owners schedule no frames or preference listeners. Browsers without
custom highlights retain normal immediate text presentation.

## Disclosure and layout
Composer autosizing and approval measurements listen to releasable font loading completion/error events. Disposal removes those listeners; an unsettled FontFaceSet.ready promise must never retain a detached surface.

Companion reads the newest relevant record and bounds its normalized Unicode output tail instead of scanning historical messages or formatting the complete growing answer.

## Interaction cadence and resources
One bounded frame queue applies native updates in order inside the host's reactive batch.

Within one presentation window, contiguous single-item appends for the same wire thread, runtime thread, item, turn, and run become one update. Runtime facts must match except for their sample timestamp and monotonic output-count/last-progress growth within the same request attempt. The latest counters remain visible; attempt and phase changes flush first. Chunks join once at flush; UTF-8 offsets and view versions must remain contiguous. A gap flushes the valid prefix and reports one recoverable synchronization error to the existing connection owner. Non-append semantic updates flush pending growth first.

The queue retains at most 64 pending updates and 4 MiB of incoming encoded update bytes. A 250 ms deadline requests a flush even if animation frames are unavailable; it cannot preempt a blocked main thread. Drag/resize cadence remains 75 ms. A replaceable performance mark records pending bytes, age and retained-update count, including high-water values. Reconnect and disposal cancel callbacks and fence stale epochs. ThreadCache, drafts and incremental Markdown keep their existing ownership.

Copy timers start only on explicit copy and reset after 1.6 seconds; clipboard failure never reports success.

The opt-in real-Service qualifier builds the production renderer, freezes historical content and provider cadence, and records cumulative runtime plus all Electron process CPU, frame/input/click/output latency, allocations and wire bytes. It verifies canonical provider content and rendered content after timing. Full-content checks open each row through its exact turn and nested tool-sequence disclosure controls before comparing every assistant and thinking item with canonical text.

The task's explicit CPU, latency, allocation, transfer and long-task thresholds are hard gates, separate from ordinary CI and the bounded main pre-push gate.

The synthetic streaming performance script additionally records renderer task/script CPU time, sampled allocation bytes (including collected objects), retained-heap delta, decoded live-envelope bytes and queue metrics. State-mutating output probes run after the timing window so reference and candidate measure the same fixture. Decoded payload bytes are not encrypted network bytes, sampled allocation is not peak heap, and this fixture is not production-provider or transport qualification.

# Boundaries

Floret remains the runtime/persistence owner; Floe owns generic parsing; Redeven owns product projection and DOM adapters. Failures keep drafts and visible content usable, with explicit retry and navigation.

# Evidence

- [Indexed record tests](../../internal/flower_ui/src/runtimeThreadRecord.test.ts)

- [Reactive record tests](../../internal/flower_ui/src/runtimeThreadRecord.client.test.ts)

- [Incremental model and semantic differential tests](../../internal/flower_ui/src/chat/markdown/streamingMarkdownModel.test.ts)

- [Soft reveal, stable ranges and motion preference checks](../../internal/envapp/ui_src/src/ui/FlowerMarkdown.softReveal.browser.test.tsx)

- [Browser transcript completion and corrected-snapshot list regression](../../internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx)

- [Frame queue Unicode soak, budgets, gaps and epoch recovery](../../internal/flower_ui/src/flowerLiveFrameQueue.test.ts)

- [Browser/Desktop synthetic performance qualifier](../../scripts/check_flower_streaming_performance.mjs)
