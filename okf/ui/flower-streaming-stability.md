---
type: UI Contract
title: Flower streaming stability
description: Incremental Markdown and local record updates preserve interactive identity.
tags: [flower, streaming, performance, interaction]
timestamp: 2026-10-20T00:00:00Z
---
# Summary

Flower renders actor-native changes through the indexed ThreadCache and the published Floe incremental Markdown parser. Ordinary growth changes the affected text/DOM region only. Stable history, code colors, copy controls, focus, selection and disclosure choices remain intact. A semantic change must remain visible; malformed updates recover through the single [live-state boundary](flower-live-timeline.md), never by omitting output or substituting a second lifecycle.

# Contract

## Local data and rendering

A snapshot initializes indexed item/message records once. Each native batch validates before one atomic commit. An append retains cache, view, message list and turn-list identity; affected message fields and their append source notify local consumers. Structural changes alone rebuild ordering/grouping. Copy and export read complete text at activation. Background threads do not create rich-text DOM, and unvisited threads retain only workspace summaries.

HTTP replacement boundaries still retain equal presentation data and independently merge context/settings/title/read authorities. Such full reads are explicit boundaries, not part of ordinary native append. Message/queue/approval/control identity uses canonical IDs, never mutable text or array position. Actual removal transfers focus to an available adjacent action or composer unless navigation already moved it.

## One Markdown parser

Released Floe `createIncrementalMarkdownParser` owns Marked, CJK and GFM syntax. Reset establishes a source baseline; append returns explicit changed blocks, inline regions or text appends; finish performs the authoritative complete parse and necessary correction. Stable block IDs and tokens survive unchanged source resets. Dependencies such as reference definitions invalidate affected regions. Long plain paragraphs and open code use append operations without rescanning the accumulated source. Parser diagnostics and complexity tests enforce that boundary.

Redeven's DOM adapter consumes those changes, retains stable block containers, appends to existing text nodes, and decorates only affected regions. Citations use the same parsed tokens and Unicode source index; they do not run another full lexer. A source/label change or finalization refreshes dependent citations even when parsing retains equal tokens. Source cards refresh when their metadata changes; media refreshes when its availability changes and otherwise settles through its existing finisher. Unrelated code controls retain identity. Replacement/removal releases citation positions and region resources. Product source cards, links and media retain host authorization and scoped resolvers.

Large literal text uses stable bounded shaping boxes rather than repeatedly mutating a megabyte Text node. Small text keeps native inline layout and the published highlighter contract; larger literal/code runs preserve exact Unicode, line breaks, selection and complete clipboard text while appending only to their active box. Boundary spaces and code tabs remain in the surrounding inline context so word spaces do not collapse and tab stops retain the line origin. Box boundaries respect complete graphemes. Browser-split adjacent Text nodes are one literal source. This is a DOM layout boundary, not another parser, hidden output or a lower refresh cadence.

Code, tables, quotes, links and nested lists remain rendered while generating. Unclosed syntax may transition locally. Completed code keeps its highlighted spans, copy button, focus and selection across later appends and finalization. Unfinished code receives its existing highlighter once on completion; settled decoration is not disposed and remounted. A generating HTML preview retains its card and updates its source as the code grows; metadata and authorization refreshes explicitly redecorate the affected region. Existing highlighter Workers remain bounded, and their CPU counts toward qualification. See [code highlighting](flower-code-highlighting.md) and [inline media](flower-inline-media.md).

## Disclosure and layout

Closed process and detail bodies mount on demand. An interface-lifetime store preserves manual inner choices by runtime/thread/kind/ID across outer unmount, navigation and reconnect. Closing releases readers, observers, timers and animations. Ordinary historical prose remains selectable and findable. Completed history uses browser layout skipping outside height animation; live-to-complete transitions retain measured layout until remount so automatic collapse cannot move a protected reading anchor.

FlowerScrollTailController is the sole transcript scroll writer. Geometry reads and writes are frame-batched. Ordinary text growth does not scan all historical rows or buttons. Following latest, user reading anchors, selection, focus, pointer gestures, menus and reduced motion retain their established contracts. Parent disclosure never rewrites an inner manual choice. [Terminal disclosure](flower-turn-process-disclosure.md) owns eligibility and reading protection.

The existing transcript viewport confines live painting without changing its scroll geometry. Progress glyphs use isolated paint layers, and thread wave motion transforms fixed geometry. Animations must not relayout history or repaint the complete document. Companion reads the newest relevant record and bounds its normalized Unicode output tail instead of scanning historical messages or formatting the complete growing answer.

## Interaction cadence and resources

One bounded frame queue applies native updates in order inside the host's reactive batch. The existing hot-interaction attribute may combine ordinary text and incomplete argument-preview growth for the same tool attempt during drag/resize. A new tool identity, attempt, completion, component clear or other semantic boundary flushes immediately. Release, cancel and blur flush pending presentation on the next frame. This does not reduce provider output, create polling or defer Stop/approval/navigation. Disconnect/disposal cancels timers and frames and releases old callbacks. A disconnect also releases transient Computer response flags so explicit recovery cannot remain disabled by an obsolete request.

Terminal process output retains its separate sequence-checked reader and one appendable Text node. The viewport controller owns painting and follow geometry. While drag owns the pointer, only the latest bounded presentation is pending; terminal status, errors and read completion flush immediately. Closing or changing identity disposes the reader. Copy timers start only on explicit copy and reset after 1.6 seconds; clipboard failure never reports success.

# Boundaries

Floret remains the runtime/persistence owner; Floe owns generic parsing; Redeven owns product projection and DOM adapters. No Worker migration, hidden output, slower provider, duplicate raw-current store, historical deep comparison or full timeline rebuild may substitute for reducing work. Failures keep drafts and visible content usable, with explicit retry and navigation.

# Acceptance

The opt-in real-Service qualifier builds the production renderer, freezes historical content and provider cadence, and records cumulative runtime plus all Electron process CPU, frame/input/click/output latency, allocations and wire bytes. It verifies canonical provider content and rendered content after timing. Baseline and candidate alternate for at least 120 seconds per measured round, without simultaneous builds or screen recording. All attempts and failures remain evidence; a short smoke or encoding microbenchmark alone is not acceptance.

Each fixture starts with a fresh empty state directory. Before becoming ready, it verifies every historical turn's successful canonical outcome and final boundary, exact user/assistant content, and two successful Activity records. Idle alone never proves a seed succeeded. Reusing old state or a failed seed aborts qualification instead of silently measuring a smaller workload. Baseline and candidate compile the identical qualification fixture against their frozen production sources. The renderer comparison retains word separation, compares reasoning literally and checks code against full-parser tokens. Output-latency evidence must observe at least 95 percent of eligible foreground markers.

Published Floret v7.74.1 releases deleted actor presentation and registry entries after joined execution/effects and committed canonical deletion. Previously captured actors stay fenced; cold lookups use canonical tombstones. Failed deletion retains recoverable state.

Fixed-workset stability repeatedly mounts and disposes the surface in the same document, verifies draft preservation across close/reopen, and checks subscriber/buffer release before replacing forks. Independent document-navigation controls distinguish Electron native-context retention from product lifetime; their evidence is retained separately without subtracting CPU or weakening resource thresholds.

Qualification includes one/seven threads, tenfold history, 200 Hz growth, 1 MiB paragraph/code, idle and fixed-workset resource stability. The task's explicit CPU, latency, allocation, transfer and long-task thresholds are hard gates, separate from ordinary CI and the bounded main pre-push gate.

# Evidence

- [Indexed record tests](../../internal/flower_ui/src/runtimeThreadRecord.test.ts)
- [Reactive record tests](../../internal/flower_ui/src/runtimeThreadRecord.client.test.ts)
- [Incremental model and semantic differential tests](../../internal/flower_ui/src/chat/markdown/streamingMarkdownModel.test.ts)
- [Region DOM lifetime](../../internal/flower_ui/src/chat/markdown/incrementalMarkdownDOM.ts)
- [Shared citation index](../../internal/flower_ui/src/chat/markdown/incrementalCitations.ts)
- [Markdown browser stability](../../internal/envapp/ui_src/src/ui/FlowerMarkdown.streamingStability.browser.test.tsx)
- [Code identity and selection](../../internal/envapp/ui_src/src/ui/FlowerMarkdown.highlight.browser.test.tsx)
- [Disclosure and reading regressions](../../internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx)
- [Frame queue interaction](../../internal/flower_ui/src/flowerLiveFrameQueue.interaction.test.ts)
- [CPU qualification fixture](../../internal/ai/flower_cpu_qualification_test.go)
- [Production qualification runner](../../scripts/qualify_flower_cpu.mjs)
