---
type: UI Contract
title: Flower streaming stability
tags: [flower, streaming, performance, interaction]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Indexed ThreadCache and published incremental Markdown apply actor-native changes only to affected text/DOM. Preserve history, code color, copy, focus, selection and disclosure. Semantic changes stay visible; malformed updates recover through the single live-state owner without suppressing output or adding lifecycle.

# Contract

## Incremental owners
Indexed item/message records initialize from snapshots. Text/extent growth preserves window/turn/decoration identity; only structural changes recompute relevant metadata. Argument previews update one block, never completed tools. Validate counters and retire stale/withdrawn attempts. Real removal restores adjacent-action/composer focus unless navigation moved it. Tests require zero historical ordinal reads for 20 appends across 100/10,000 archived items.

Structural scans read immutable source identities without opening every retained store proxy. Cached rows keep their reactive message owner; plain snapshots cannot supply live getters. Prompt history observes user content and status only. Activity counts follow replaced block identity. Sequence placement touches changed membership and registrations, preserving borrowed row owners, focus, selection and prepend anchors. Following-tail inspection checks interaction blockers without measuring historical rows; immediate disclosure settlement performs no unused geometry reads.

Process rows reuse immutable block classification; final/intermediate membership, live status and turn outcomes remain current. Computer candidates subscribe only to relevant target references. Observed-window turn identity stays separate from the complete reading document: wire-only replacements neither rebuild archived membership nor rescan historical ordinals. Actual ownership, ordering, coverage and lifecycle changes still publish atomically.

Viewport binding reads no offsets or extents during DOM mutation. Initial nested-tail placement and disclosure callbacks join the existing before-paint layout pass; explicit reopening restores following intent, while transferred reading anchors retain their offset. Native input captures its starting offset before the browser default action so deferred measurement cannot erase wheel movement.

Same-run authoritative snapshots retain the thread presentation store and equal collections. Replacing the observed runtime window must not rebind every retained row's layout controller. A new execution retains the existing canonical-prefix checks and gets its own presentation. Structural message changes still invalidate membership; content-only advancement stays on its existing text owner.

Published createIncrementalMarkdownParser owns Marked/CJK/GFM. reset installs full baseline, append changes regions and finish corrects complete content. Changed snapshots reset because token offsets/identity can move; reuse only exact tokens/offsets. Same-source metadata preserves regions. Completion/collapse/replacement retains every authored block. [Highlighting](flower-code-highlighting.md), [diagrams](markdown-diagrams.md) and [media](flower-inline-media.md) retain their owners.

## Text and layout
New prose fades to currentColor over 320 ms via 20 fixed CSS highlight phases, without node splitting, line movement or delivery delay. History/corrections are immediate; links/code/media keep colors. No stylesheet changes, computed-style reads or per-frame inline writes. Limit 32 transient groups/owner and diff inspection to 8,192 characters/128 nodes per region; larger changes appear immediately. Completion settles valid effects; reset/disposal/hidden/reduced-motion/forced-color clears them. Published hot drag/resize also settles ink immediately while text, selection and DOM remain live; only post-release additions animate. Historical/unsupported-API owners schedule nothing.

Cold historical bodies stage until complete, retaining offset/staging through reconnect; expose final Markdown geometry without height motion. Sample table/code/list/text from first visible frame. Existing prose/live output remain incremental. Font measurements use disposable completion/error listeners, not detached FontFaceSet.ready retention. Companion reads newest relevant record plus bounded Unicode tail.

## Queue and measurements
One ordered frame queue atomically applies envelopes in reactive batches. Cooperative 4 ms budget includes reactive work and yields between envelopes, never preempts one expensive envelope. Capture failures inside batch so recovery commits before rethrow to connection owner. Ready waits for drain; other reads pause at 16 frames/1 MiB. Epoch/failure/disposal releases readers and fences late callbacks.

Coalesce only contiguous one-item appends with exact thread/item/turn/run/reading revision and same attempt facts except time/monotonic progress. Keep semantic boundaries/clears; join once preserving UTF-8/version. Gaps reject whole pending batch and report one sync error. Growth bounds: 64 frames/4 MiB/250 ms, 75 ms during drag/resize. Semantic timer may replace stalled rAF but never overtake growth. One valid 32 MiB wire envelope plus reserve is allowed with backpressure. Diagnostics omit content; the slowest envelope records only timing, kind and structural counts to distinguish baseline replacement from ordinary item growth. Copy success feedback lasts 1.6 s; denial is never success.

Explicit real-Service qualifier freezes history/provider cadence and measures production Runtime/Electron CPU, allocation, wire, frame/input/click/output. After timing, real disclosure controls compare all prose/thinking against canonical content. [Long-thread](../operations/flower-long-thread-gate.md) adds sustained growth/floating input; both stay outside unified gates. Synthetic task CPU/heap/allocation/decoded queue samples mutate state only after timing and cannot certify providers/encryption or peak memory.

# Boundaries

Floret remains the runtime/persistence owner; Floe owns generic parsing; Redeven owns product projection and DOM adapters. Failures keep drafts and visible content usable, with explicit retry and navigation.

# Evidence

- [Indexed record tests](../../internal/flower_ui/src/runtimeThreadRecord.test.ts)

## Completed response validation feedback

A structured response_validation failure after response.completed uses localized
copy stating that content arrived but final verification failed. Existing content
remains visible. Details stay collapsed, copyable and preserve the safe nested
conflict evidence. Rendering never interprets peer prose as markup or retries a
turn automatically. Source-only hosted-search variation accepted by Floret does
not create an error card. Env App and Desktop ship identical complete catalogs.
Evidence: FlowerSurface.contextErrors shared/browser tests and i18n contracts.
