---
type: UI Contract
title: Flower streaming stability
description: Incremental Markdown and local record updates preserve interactive identity.
tags: [flower, streaming, performance, interaction]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Flower renders actor-native changes through the indexed ThreadCache and the published Floe incremental Markdown parser. Ordinary growth changes the affected text/DOM region only. Stable history, code colors, copy controls, focus, selection and disclosure choices remain intact. A semantic change must remain visible; malformed updates recover through the single [live-state boundary](flower-live-timeline.md), never by omitting output or substituting a second lifecycle.

# Contract

## Local data and rendering
Snapshots initialize indexed item/message records. Growth updates the affected region while preserving interactive identity; tests assert canonical fields rather than obsolete JSON signatures. Actual removal moves focus to an adjacent action or composer unless navigation already moved it.

## One Markdown parser
Released Floe `createIncrementalMarkdownParser` owns Marked/CJK/GFM: reset sets a complete source baseline, append returns changed regions, finish authoritatively parses/corrects all content. Changed snapshots reset the complete baseline because tokens can move offsets and identities; reuse exact tokens at unchanged offsets and retire other old regions. Identical-source metadata retains regions. Completion, process collapse and replacement preserve all authored blocks. See [highlighting](flower-code-highlighting.md) and [media](flower-inline-media.md).

## Soft live text reveal
Added prose ranges fade to theme color over 320 ms through CSS custom highlights, without splitting nodes, delaying delivery, moving lines or replaying read content. History/corrections render immediately; links, code, media and controls keep their colors and behavior. Twenty fixed CSS phases use originating `currentColor`, avoiding stylesheet mutation, computed-style reads or per-frame inline writes.

Each owner has at most 32 transient groups; diff inspection is bounded at 8,192 characters/128 text nodes per region. Larger changes remain immediately readable. Completion lets valid effects settle; reset, unmount, hidden documents, reduced motion and forced colors clear them. Historical owners schedule no frames/listeners; unsupported highlight APIs use immediate text.

## Disclosure and layout
Composer/approval font measurements use releasable completion/error listeners, never retaining detached surfaces through `FontFaceSet.ready`. Companion reads only the newest relevant record and a bounded normalized Unicode tail.

## Interaction cadence and resources
One bounded frame queue applies updates in order inside the host reactive batch. Coalesce only contiguous single-item appends with matching wire/runtime thread, item, turn and run. Facts must match except timestamp and monotonic output/progress growth in the same request attempt; keep latest counters. Attempt/phase/non-append changes flush first. Join chunks once; UTF-8 offsets and versions remain contiguous. Gaps flush valid prefixes then report one recoverable synchronization error to the connection owner.

Limits are 64 updates, 4 MiB encoded bytes and a 250 ms flush deadline (not main-thread preemption); drag/resize cadence is 75 ms. A replaceable performance mark exposes current/high-water bytes, age and count. Reconnect/disposal cancel callbacks and fence epochs. Copy feedback starts only on success, lasts 1.6 seconds, and never reports clipboard failures as successful.

The opt-in real-Service qualifier freezes history/provider cadence, builds production UI and measures runtime, all Electron process CPU, frame/input/click/output latency, allocations and wire bytes. After timing it opens exact turn/nested-sequence controls and compares every assistant/thinking item with canonical content. Task-specific thresholds are hard gates, separate from bounded CI/main integration.

The synthetic qualifier measures task/script CPU, sampled allocations, retained heap, decoded envelopes and queue metrics; state-mutating probes run after timing. Decoded payload is not encrypted traffic, sampled allocation is not peak heap, and synthetic results do not qualify production providers/transports.

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
