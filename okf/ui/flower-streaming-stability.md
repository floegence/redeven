---
type: UI Contract
title: Flower streaming stability
description: Incremental Markdown and local record updates preserve interactive identity.
tags: [flower, streaming, performance, interaction]
timestamp: 2026-10-20T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

Flower renders actor-native changes through the indexed ThreadCache and the published Floe incremental Markdown parser. Ordinary growth changes the affected text/DOM region only. Stable history, code colors, copy controls, focus, selection and disclosure choices remain intact. A semantic change must remain visible; malformed updates recover through the single [live-state boundary](flower-live-timeline.md), never by omitting output or substituting a second lifecycle.

# Contract

## Local data and rendering
Snapshots initialize indexed item/message records. Text/body extent growth retains history-window, turn and decoration identity; only membership, replacement, turn or context changes recompute their relevant metadata. Growing argument previews update their existing reactive block without revisiting completed tools; the same canonical validation still rejects invalid counters and retires withdrawn/stale attempts. Actual removal moves focus to an adjacent action or composer unless navigation already moved it. Regression fixtures retain 100 and 10,000 archived items and require zero historical ordinal reads for twenty text appends.

## One Markdown parser
Released Floe `createIncrementalMarkdownParser` owns Marked/CJK/GFM: reset sets a complete source baseline, append returns changed regions, finish authoritatively parses/corrects all content. Changed snapshots reset the complete baseline because tokens can move offsets and identities; reuse exact tokens at unchanged offsets and retire other old regions. Identical-source metadata retains regions. Completion, process collapse and replacement preserve all authored blocks. See [highlighting](flower-code-highlighting.md) and [media](flower-inline-media.md).

## Soft live text reveal
Added prose ranges fade to theme color over 320 ms through CSS custom highlights, without splitting nodes, delaying delivery, moving lines or replaying read content. History/corrections render immediately; links, code, media and controls keep their colors and behavior. Twenty fixed CSS phases use originating `currentColor`, avoiding stylesheet mutation, computed-style reads or per-frame inline writes.

Each owner has at most 32 transient groups; diff inspection is bounded at 8,192 characters/128 text nodes per region. Larger changes remain immediately readable. Completion lets valid effects settle; reset, unmount, hidden documents, reduced motion and forced colors clear them. Historical owners schedule no frames/listeners; unsupported highlight APIs use immediate text.

## Disclosure and layout
Cold historical text remains a loading presentation until all canonical chunks arrive. A reconnect retains both read offset and unpublished staging. Complete bodies enter at final geometry without height animation; browser acceptance samples table, code, list and text geometry from the first exposed frame. Existing readable text and live output retain their separate incremental behavior.

Composer/approval font measurements use releasable completion/error listeners, never retaining detached surfaces through `FontFaceSet.ready`. Companion reads only the newest relevant record and a bounded normalized Unicode tail.

## Interaction cadence and resources
One bounded frame queue applies every envelope in order, including semantic boundaries. Transport callbacks enqueue; each envelope commits atomically inside its host reactive batch. A four-millisecond cooperative budget includes reactive work and yields between envelopes through a timer task. It cannot preempt an individual expensive envelope. Apply failures are captured inside the reactive batch, allowing recovery notifications to commit before the error is rethrown to the connection owner. Ready waits for the queue to drain before admitting navigation; other reads pause at sixteen pending frames or one MiB. Disposal, failure and epoch changes release waiting readers and fence obsolete callbacks.

Coalesce only contiguous single-item appends with matching thread, item, turn, run and reading revision. Facts must match except timestamps and monotonic progress in the same request attempt. Preserve semantic boundaries and component clears. Join chunks once, preserving UTF-8 offsets and versions. A detected pending gap invalidates that batch and reports one synchronization error to the connection owner; no partially accepted batch is published.

Growth limits remain 64 frames, four MiB encoded bytes and a 250 ms presentation deadline; drag/resize cadence is 75 ms. Semantic work replaces a stalled animation-frame schedule with an immediate timer without overtaking earlier growth. One supported atomic wire envelope can use the existing 32 MiB allowance plus the growth reserve, while backpressure blocks further reads. Diagnostics expose bytes, age, count and application duration without transcript content. Copy feedback starts only on success, lasts 1.6 seconds, and never reports clipboard failure as success.

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
