---
type: AI Runtime Contract
title: Model context usage and compaction
description: Explicit manual compaction intent, Goal continuation, and canonical usage presentation.
tags: [ai, models, context, compaction]
timestamp: 2026-10-20T00:00:00Z
---
# Summary

Published Floret v7.74.0 owns context compaction, Goal continuation, cancellation, canonical installation, restart recovery, and usage. Redeven authorizes and transmits explicit intent and presents canonical state. Pure compaction ends after installation or noop. Explicit Goal continuation prepares compaction and continues the active Goal in one execution through the existing Engine and review loop. Failure, cancellation before installation, and noop retain effective context.

# Contract

## Explicit manual intent

`POST /_redeven_proxy/api/ai/threads/{id}/context/compact` accepts `storage_generation`, `client_request_id` and optional `continue_goal`. Omitted or false preserves pure compaction. True selects `goal_continuation` only when Floret finds an active canonical Goal during admission. The handler verifies endpoint authority, generation, and the frozen model configuration, then invokes optional public `ThreadContextCompactor.CompactContext`. Admission returns HTTP 202 before model preparation or provider work. Floret admits only idle threads with no queued input or unresolved interaction; its explicit `context_compaction` turn carries real TurnID and RunID without a fabricated user message.

The command menu, button, and standalone `/compact` default to compaction followed by unfinished Goal work, including embedded canvas conversations. The menu describes that intent before execution and offers a keyboard- and pointer-accessible pure-compaction secondary action through the same route. Enter, the selected suggestion, and the primary action resolve an incomplete prefix such as `/com` to the same command. Ordinary Send rejects standalone `/compact`, even with context or attachments. Admission preserves draft attachments, file references, canvas selection, and edited text. Acceptance clears unchanged complete command text or its submitted prefix; the suggestion menu follows the remaining draft and closes when that text is cleared. Rejection retains the draft, and composition or Shift+Enter does not execute a command. Navigation and editing stay available. Transport uncertainty retains the same request key and frozen continueGoal intent in the short-lived transport outbox; replays use the dedicated route. Older entries without intent remain pure compaction. Pure-compaction failures retry with a new key through that capability; Goal-continuation failures use upstream Retry, reusing installed preparation and confirmed tools. Unknown effect outcomes require inspection and an explicit user continuation. Redeven never starts work from a completion event, reconnect, or initialization watcher.

The latest failed or cancelled pure-compaction operation exposes an icon-only Retry compression button beside its status in one centered row. The button uses a pointer cursor and a localized tooltip on hover or focus. Status details and retry remain separate keyboard controls. The divider and preparation-failure card share canonical preflight, selection and permission checks, then the existing admission/outbox. Only the divider carries the primary retry when it exists. Pending preflight, preparation and dispatch show Retrying compression; unknown delivery releases that busy label but blocks a new command until existing outbox recovery resolves it. Pure-compaction terminal retry uses a new request key; Goal continuation uses upstream Retry; unknown delivery retains the original key. Every exit releases preparation ownership, with navigation aborting superseded waits. Active progress uses the current canonical compaction rather than an ordinary preparing label; canonical automatic recovery retains its countdown priority.

Request deadlines and recovery exhaustion are Provider failures while the owning execution remains active. Explicit cancellation and atomic installation retain upstream authority. Historical mistaken cancellation markers stay unchanged; no error-string repair or host-owned migration is performed.

Floret installs the summary and model-context boundary transactionally. Only pure compaction also commits the terminal result at installation. Goal continuation remains active through business work, questions, approvals, and current Goal review; an installed summary never implies task completion. Stop fences preparation, work, review, and waits. Schema 28 -> 29 preserves historical pure-compaction semantics and rejects older writers. Installation and cancellation have one transaction winner. Successful installation invalidates provider continuation and confirmed input usage; the installed estimate serves pressure decisions; the overview remains unavailable until the next valid request confirms input usage. Noop does not alter context, generation, or continuation. Manual requests do not require the automatic threshold, but still require context above the 50,000-token target, a complete cut, and useful savings. There is no force mode.

Floret reads complete eligible canonical history for summarization, preserving
formatting, tool arguments, references, and runtime facts. Its single budgeted
loop carries the latest candidate summary through ordered lossless fragments
when a request cannot fit. It does not clip ordinary messages to fixed previews
or install truncated output. Intermediate candidates remain upstream-owned
memory; failure or cancellation preserves the effective context. User and
confirmed tool images use the same loop with indivisible native image inputs
and safe source labels. The [visual summary and original reread contract](image-read-and-retention.md#visual-summaries-and-rereads)
defines image budgets, frozen retries, locators and exact-detail recovery.
Projection revision v10 resets prior request lineage through Floret's explicit
boundary; existing checkpoints and canonical v19 bytes are not rewritten.
Redeven adds no summary generator, batching policy, or durable compaction state.

The 50,000-token target guides tail selection; it does not require a fixed-length summary or fill unused budget. The actual result combines the generated summary, preserved user requirements, retained complete tail, and checkpoint structure. The summary has a ceiling, so the result may be substantially below the target. Protecting the latest complete input or tool exchange can also exceed the target; Floret records that pressure instead of clipping those messages. The divider keeps a short status label. After successful installation, its tooltip shows only a compact before/after message estimate, independently of system-prefix and tool-definition tokens in a complete provider request. Historical values retain their original estimates; no full-request total is reconstructed from them. Missing estimates leave the status without an empty detail control. Failure and noop retain their actionable error or result.

## Compaction decision evidence

The canonical lifecycle optionally retains the frozen trigger candidate, pressure
and validated replacement. Full-request estimates include system instructions
and tools, separately from message estimates and native usage. Calibrated
pressure keeps its qualified request identity; provider overflow is an explicit
signal. Historical or unprepared manual candidates remain unavailable. Failure
and cancellation keep trigger evidence without claiming installation. Floret
schema 25 -> 26 preserves historical payloads, rejects older writers and settles
interrupted observations at terminal turns. Redeven only maps these facts.

Canonical decision diagnostics remain in the mapped contract; the divider does
not append pressure thresholds, missing-evidence notices or scope paragraphs.
Its shared SurfaceFloatingLayer owns local hosting, projection and clamping in
Workbench. Available details remain keyboard accessible and wrap if needed.
Pointer exit, Escape, Tab, focus loss and outside pointer actions dismiss the
layer; process collapse closes it through the existing visibility owner.

## Projection and usage

Floret installs the complete context snapshot in its actor-owned current view before publishing its version. Detail, baseline, live, terminal and child frames map that same snapshot through one product projection; the browser receives no raw runtime context. Context changes bypass text cadence, while equal snapshots still coalesce text growth within the existing bounded queues. Absent fields preserve context, null clears nullable objects and empty arrays clear lists. Invalid payloads reject the frame and retain the last valid view through existing resync and detail recovery. There is no usage-only publication or polling path.

Redeven neither stores compaction lifecycle records nor accumulates usage. Each operation keeps its explicit TurnID, RunID, first-lifecycle canonical ordinal and AfterItemID anchor. Canonical order places it among parent events; the anchor retains message insertion boundaries. Status updates keep the same divider identity and position across fork, pagination, refresh and reconnect. Empty history has no invented anchor. An observed active manual noop uses the existing result notice; history reload does not repeat notifications.

Automatic compactions belong to their execution turn and collapse with its process, including a process containing only compactions. The shared summary remains reachable and expansion restores original order. Independent manual compactions keep their own context_compaction turn even when anchored after the preceding answer. The existing disclosure preference, inspection protection, scroll anchor and motion owner remain authoritative. Hidden rows are inert and aria-hidden; compaction tooltips reset on collapse, and focus returns to the summary. Approvals, unresolved questions, uncertain effects, Stop, Retry, continuation and draft recovery keep their existing visible controls.

The compact panel displays native input tokens from the last confirmed request
with =. Without a valid confirmed request it displays an em dash, including
after model/policy changes or successful compaction. Legal native zero displays
= 0. The capacity ratio is labeled Last request input / model capacity; native
provider execution usage is not an independent current-window measurement.

The [visible-input categories](flower-managed-model-context.md#presentation)
use Unicode code points and their own character denominator. They never fit a
provider token total or expose a token remainder. One frozen request owns the
total, characters and recent cache rate. Historical or unavailable characters
leave the native overview intact without borrowing newer context. New estimates
only drive warnings labeled Current request. Budget thresholds and output limits
remain outside the compact popup. Controls and focus recovery remain available
when distribution changes.

Cumulative thread totals survive installation. Cache hit rate is `cache_read / (input + cache_read + cache_write)` over those disjoint buckets. Pressure supplies only actionable warnings. No host watermark or second ledger is retained.

Run input limits remain cumulative Floret `TurnLimits.MaxInputTokens`. Explicit output limits also supply context headroom; otherwise the resolved model capability supplies headroom while the provider request retains its normal unset output option. Redeven does not invent a total budget or infer serving capacity from model weights.

## Deterministic timeline qualification

`REDEVEN_COMPACTION_RUNTIME_UI=1 GOWORK=off go test ./internal/ai -run '^TestFlowerCompactionRuntimeUI$' -count=1 -v` starts a task-owned SQLite Runtime and dynamic HTTP port with a scripted overflow provider. It proves start and completion reach the actual FlowerSurface while the turn stays active, then verifies stable identity, disclosure and refresh. The test logs its commit, PID, port and state path and cleans its listeners, browser and temporary state on exit. It is opt-in qualification, outside ordinary commit, push and CI gates.

Optional `REDEVEN_COMPACTION_HISTORY_COPY`, `REDEVEN_COMPACTION_HISTORY_THREAD` and `REDEVEN_COMPACTION_HISTORY_TURN` select an already consistent private database copy. Only the copy is opened through published Floret, with deferred execution and a factory that refuses execution. Browser checks retain every operation, canonical neighbor order, one row per operation, complete collapse and refresh. The original database and running thread are never opened or mutated by this qualification. Empty managed-context collections map to wire arrays without mutating upstream snapshots.

## Real DeepSeek qualification

`scripts/check_flower_context_deepseek.sh --compaction` reads the configured official DeepSeek model and credentials through production parsers and uses isolated state. The recorder retains request classification, hashes, sizes, continuation presence, and native usage without credentials, headers, or source user content. Facts appear only at the end of the earliest synthetic input, beyond the former 1,200-byte preview boundary. Qualification also checks that summary requests receive those facts. Legal public admissions create pressure; the test proves that the original source leaves the retained tail, the summary preserves the facts, and an independent recall succeeds.

Four mandatory lanes cover small-history noop, manual installation/replay/restart/repeated installation, automatic compaction with a 256,000/28,000 test budget, and automatic compaction at the configured full budget. Every lane has bounded rounds and time. Missing usage, unavailable providers, skipped tests, timeout, or absent compaction fail qualification. Simulated overflow remains deterministic evidence, never a claim of natural DeepSeek overflow.

`internal/envapp/ui_src/scripts/checkFlowerCompactionRuntime.mjs` qualifies the built Runtime and real Tessiven canvas with isolated state and the same configured provider. It checks the dedicated command route, summary-only manual execution, draft and canvas-reference preservation, replay and refresh with one divider, and natural full-window automatic compaction followed by recall. Its output retains synthetic canonical snapshots, screenshots, and sanitized request accounting.

# Boundaries

Floret owns one shared summary, validation, convergence, and installation path. Redeven owns authorization, frozen product configuration, transport, localization, and presentation. Domain schema 12→13 migration is exclusively upstream-owned. Historical `/compact` conversation output is never retroactively classified as successful compaction.

Cache counters and the latest/cumulative tooltip rates follow the [request reuse and usage contract](model-request-reuse.md#cache-usage-presentation), using canonical confirmed usage rather than another host store.

# Evidence

- `redeven:internal/ai/compact_thread_context.go` - Authorized asynchronous admission through published Floret.
- `redeven:internal/ai/compact_thread_context_test.go` - Canvas Send rejection, blocked preparation, disconnect, replay, and authorization.
- `redeven:internal/codeapp/appserver/server_ai_compaction_test.go` - HTTP admission and strict request boundary.
- `redeven:internal/ai/floret_thread_context.go` - Canonical divider anchors and usage mapping.
- `redeven:internal/ai/flower_compaction_ui_test.go` - Isolated scripted Runtime and optional historical-copy qualification.
- `redeven:scripts/check_flower_compaction_ui.mjs` - Actual FlowerSurface live, order, collapse and refresh assertions.
- `redeven:internal/ai/run_e2e_deepseek_compaction_acceptance_test.go` - Four real provider lanes.
- `redeven:scripts/check_flower_context_deepseek.sh` - Mandatory opt-in acceptance entry point.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.compaction.browser.test.tsx` - Dedicated embedded command and draft/navigation interaction.
- `redeven:internal/envapp/ui_src/scripts/checkFlowerCompactionRuntime.mjs` - Built Runtime and real provider canvas qualification.
- `redeven:internal/flower_ui/src/chat/flowerContextPresentation.ts` - Canonical usage and localized noop presentation.
