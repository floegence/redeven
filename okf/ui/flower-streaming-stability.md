---
type: UI Contract
title: Flower streaming stability
description: Preserve interactive subtree identity and bound streaming rendering work in the shared Flower UI.
tags: [flower, streaming, performance, interaction]
timestamp: 2026-09-09T00:00:00Z
---

# Summary

Flower's shared chat UI retains the identity of unchanged presentation data and
interactive DOM across live current views. ThreadCache owns cached conversation
facts; local components own disclosure, focus, and bounded rendering work.
An execution update must not restart unrelated interactions, network readers,
animations, or observers. Real authoritative changes must remain visible.

# Contract

`ThreadCache` shares complete immutable JSON values across current views. Identity
aligns messages, queue entries, approvals, and subagents; complete value comparison
decides whether to retain them. Thread changes cannot share interaction state.
Title overlays remain stable when another thread's summary changes. Timeline
validation and rendering reuse one projection, with cursor, decorations, input,
queue, and error dependencies included. WeakMap caches release obsolete values
with their owning messages and arrays.

`FlowerKeyedList` iterates domain identity and gives children accessors for current
data. Queue identity includes ThreadID and queue_id. Approvals and questions use
their existing execution and interaction identities. Actual removal transfers
focus to an adjacent available operation or the composer, unless navigation or
the user has already moved focus. Plain display rows without a business ID retain
unchanged values; mutable text and array positions do not become interaction IDs.

The activity row retains its complete presentation. Nonterminal details mount a
component once per semantic kind and read current properties. Existing keyed
thread cards, reference chips, timeline entries, and child activity rows keep their
ownership. No new durable state, public Floret contract, or second transport is
introduced.

## Streaming dependency audit

This inventory records paths inspected before and during the repair. "Retained"
means the existing owner already isolates the path from unrelated stream data.
The shared Surface is used by Desktop and the Env App.

| Surface or side effect | Disposition and guard | Evidence |
| --- | --- | --- |
| History and tool messages | Repaired: full structural sharing and cached timeline branches | Current-view stability; shared timeline tests; 300-update browser regression |
| Queued turns | Repaired: scoped identity, accessors, removal focus transfer | 300-update focus, hover, native click and drag tests; real reorder and removal |
| Subagent dropdown | Repaired: retained summaries and derived items, child ThreadID keys | 300-update dropdown controls; subagent lifecycle browser tests |
| Child transcript and window | Repaired: retained child projection; retained child keys and independent viewport | 300 child current updates, HTTP/live/reconnect ordering, separate parent/child scroll assertions |
| Approvals and question controls | Repaired: execution/interaction keys and current accessors | 300-update controls, answer draft and focus; real prompt edits and approval resolution; decision/input tests |
| Structured rows, summaries, errors, questions, file read/diff, search/fetch, Todo and child-tool details | Repaired: stable detail components and retained nested presentation | Eleven open detail kinds with zero child-list mutations during 300 updates; selection, latest file action and real content edit |
| Reference chips and icons | Repaired icon factories; retained reference ID controls | 300 equal snapshots without node mutations; changed label and latest activation; canonical-reference browser tests |
| Attachments and composer references | Retained: composer draft/reference owner, upload identity, search query/root generation | Attachment and composer-reference tests, canonical admission/restore tests |
| Thread rail and thread menus | Retained ThreadID controls; repaired stable summary overlays | Rail nodes in 300-update regression; thread-card, title, navigation and menu tests |
| Terminal reader and output viewport | Repaired: execution/process/eligibility scalar dependencies; canonical snapshot effect does not track live output | No extra read starts during 300 updates; terminal identity, delta, status, internal scrolling and disposal tests |
| Disclosure motion and geometry | Repaired: 180/140 ms motion, natural open height, observer only while opening, one viewport frame | 300 notifications produce one read/write pass; motion deadline, native press, wheel, cancellation and reduced-motion tests |
| Markdown and code-copy controls | Repaired: full lexer plus complete-token/reference-aware HTML reuse, local copy decoration | 300 updates retain completed code/copy controls; parser count and reference/replacement/finalization tests |
| Raw code tail | Repaired: one appendable Text node and reactive raw/HTML/empty branch | 10,000 separately flushed appends, selection, early-prefix replacement, final content and copy checks |
| Progress, usage, timers and observers | Repaired progress/usage values; retained mount/visibility/query-driven timers, resource loading and menu listeners | Source dependency inspection, no new requests/observers/animations in stability regression, visibility and resource tests |
| Transport, outbox and restored inputs | Retained single workspace connection and canonical request settlement; repaired frame coalescing and abort-listener cleanup | Per-input validation, ordered semantic/reconnect boundaries, disposal; architecture, admission and storage recovery tests |

The activity clock starts once per Surface mount. Copy timers start from explicit
copy actions. Directory resources depend on adapter/runtime scope. Reference
search depends on draft query and root. Menu listeners depend on visibility;
terminal output rendering depends on output/status. Thinking indicators depend on
their visible running state. These owners do not subscribe to arbitrary current
view object identity. Their existing cleanup remains in place.

## Bounded streaming work

One transient frame buffer may combine strictly prefix-only text appends within
the same live execution. Full envelope comparison excludes any other semantic
change, and every candidate passes current-view and timeline validation. Queue,
approval, tool, error, completion, malformed input, and reconnect boundaries flush
pending text before normal ordered handling. The buffer is neither a lifecycle
owner nor a durable replay queue.

Markdown still lexes the complete current source. HTML reuse requires equal full
tokens and reference definitions, and the cache retains only current tokens.
Replacement and completion run the same parser contract. Copy controls are
decorated only in changed HTML regions. Raw tails append to one Text node and
replace that node's data when the source stops being a prefix extension.

[Disclosure motion](flower-activity-interaction.md) retains short interaction
feedback without animating steady streaming growth. Existing maximum detail
height and internal scrolling remain. No virtual list, Worker, or user-facing
performance configuration is added.

# Boundaries

This change stays in shared frontend presentation, tests, and documentation.
Floret public APIs, durable records, live protocol shapes, validation, permissions,
and action authorization retain their existing contracts. ThreadCache remains the
only conversation cache; frame buffers and component caches are transient.

# Evidence

## Reproducible acceptance

Run the production-renderer fixture after installing the frozen Env App and
Desktop dependencies and verifying the official Electron test runtime:

```bash
bash scripts/check_desktop_electron_test_runtime.sh desktop
node scripts/check_flower_streaming_performance.mjs --ref=ea763ee9d --output=/tmp/flower-before
node scripts/check_flower_streaming_performance.mjs --output=/tmp/flower-after
```

The runner builds the real shared Surface with the Desktop production Solid/CSS
configuration and published UI dependencies. It renders deterministic canonical
runtime facts through an adapter in Chromium and an isolated official Electron
BrowserWindow. This measures the UI, not provider/network/backend latency. It does
not operate an existing Desktop profile or another task's process.

Each renderer executes 72-message/20-tool and 500-message/100-tool scenarios at 30
and 60 incoming updates per second for eight seconds, with repeated native tool
toggle clicks. Metrics include delivered view versions, frame intervals, click
event timestamp to two animation frames, long tasks, DOM additions/removals,
protected queue mutations, lexer/parser calls, request starts, and CDP layout/style
cost. Each run records hardware, runtime, process/profile identity where available,
final screenshots, and continuous browser video or Electron frame sequences.

The current-source command fails if protected queue nodes change, click P95 exceeds
100 ms, normal-load frame P95 exceeds 20 ms, or a stress run contains a long task
of at least 100 ms. Baseline runs record failures without enforcing that threshold.
Interaction tests separately verify content correctness, node identity, focus,
selection, hover, drafts, drag, native activation, and idle cleanup. Timing is a
bounded fixture result, not a guarantee for future components or unlimited history.

## Recorded comparison

The September 9, 2026 run used Apple M5 Pro, Darwin 25.5.0, a 1280 by 900 CSS-pixel
viewport, official Electron 41.10.5, and the baseline `ea763ee9d`. All eight repaired
scenarios passed. Values below are baseline to repaired, in milliseconds.

| Renderer | Messages/tools | Input rate | Frame P95 | Click feedback P95 | Queue node additions/removals |
| --- | --- | --- | --- | --- | --- |
| Chromium | 72/20 | 30 Hz | 9.2 to 9.1 | 19.3 to 16.4 | 980 to 0 |
| Chromium | 72/20 | 60 Hz | 9.2 to 9.2 | 19.9 to 15.6 | 2,024 to 0 |
| Chromium | 500/100 | 30 Hz | 50.4 to 9.2 | 59.8 to 16.9 | 756 to 0 |
| Chromium | 500/100 | 60 Hz | 50.3 to 9.2 | 54.1 to 18.1 | 784 to 0 |
| Electron | 72/20 | 30 Hz | 17.6 to 17.5 | 33.4 to 31.6 | 988 to 0 |
| Electron | 72/20 | 60 Hz | 17.4 to 17.4 | 32.2 to 30.1 | 2,008 to 0 |
| Electron | 500/100 | 30 Hz | 65.7 to 17.5 | 59.3 to 31.3 | 684 to 0 |
| Electron | 500/100 | 60 Hz | 51.0 to 17.5 | 56.1 to 24.6 | 704 to 0 |

No repaired run recorded a long task of at least 50 ms or an additional connection
or terminal read during unrelated text streaming. In the Electron 500/100, 60 Hz
case, parser calls fell from 211,024 to 471. The input timer delivered 176 baseline
updates versus 501 repaired updates because baseline main-thread work delayed
timer execution. Layout time was 971.1 versus 852.4 ms in total, or approximately
5.52 versus 1.70 ms per delivered update; total layout cost alone is not a fair
throughput comparison. Full records include every sample and video/frame evidence.

The focused acceptance run also passed 615 shared logic tests and 117 Flower
browser tests, plus reference-icon and geometry batching regressions. Both host
builds and lint checks passed. Repository integration uses the separate exact-main
pre-push gate; the focused and timing results do not replace that gate.

## Related tests and contracts

- [Current-view stability](../../internal/flower_ui/src/runtimeCurrentView.stability.test.ts)
- [Browser streaming stability](../../internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx)
- [Markdown streaming stability](../../internal/envapp/ui_src/src/ui/FlowerMarkdown.streamingStability.browser.test.tsx)
- [Frame boundary validation](../../internal/flower_ui/src/flowerLiveFrameQueue.test.ts)
- [Production performance runner](../../scripts/check_flower_streaming_performance.mjs)
- [Activity interaction contract](flower-activity-interaction.md)
- [Live timeline authority](flower-live-timeline.md)
