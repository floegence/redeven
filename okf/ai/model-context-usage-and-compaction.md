---
type: AI Runtime Contract
title: Model context usage and compaction
description: Independent manual compaction, automatic continuation, and canonical usage presentation.
tags: [ai, models, context, compaction]
timestamp: 2026-10-10T00:00:00Z
---
# Summary

Published Floret v7.27.2 owns context compaction, cancellation, canonical installation, restart recovery, and usage. Redeven authorizes an independent manual operation and presents the canonical result. Manual compaction ends after installation; automatic compaction continues the current task. Failure, cancellation before installation, and noop retain effective context.

# Contract

## Independent manual operation

`POST /_redeven_proxy/api/ai/threads/{id}/context/compact` accepts only `storage_generation` and `client_request_id`. The handler verifies endpoint authority, generation, and the frozen model configuration, then invokes optional public `ThreadContextCompactor.CompactContext`. Admission returns HTTP 202 before model preparation or provider work. Floret admits only idle threads with no queued input or unresolved interaction; its explicit `context_compaction` turn carries real TurnID and RunID without a fabricated user message.

The command menu, button, and standalone `/compact` use that one action, including embedded canvas conversations. Enter, the selected suggestion, and the primary action resolve an incomplete prefix such as `/com` to the same command. Ordinary Send rejects standalone `/compact`, even with context or attachments. Admission preserves draft attachments, file references, canvas selection, and edited text. Acceptance clears unchanged complete command text or its submitted prefix; the suggestion menu follows the remaining draft and closes when that text is cleared. Rejection retains the draft, and composition or Shift+Enter does not execute a command. Navigation and editing stay available. Transport uncertainty retains the same request key in the short-lived transport outbox; replays use the dedicated route. A failed or cancelled operation retries with a new key through the same capability. Ordinary Retry cannot reinterpret the operation as the earlier conversation.

Floret installs the summary, model-context boundary, and manual terminal result in one transaction. Installation and cancellation have one transaction winner. Successful installation invalidates provider continuation and confirmed input usage; the installed estimate describes current usage until the next normal request confirms it. Noop does not alter context, generation, or continuation. Manual requests do not require the automatic threshold, but still require context above the 50,000-token target, a complete cut, and useful savings. There is no force mode.

Floret reads complete eligible canonical history for summarization, preserving
formatting, tool arguments, references, and runtime facts. Its single budgeted
loop carries the latest candidate summary through ordered lossless fragments
when a request cannot fit. It does not clip ordinary messages to fixed previews
or install truncated output. Intermediate candidates remain upstream-owned
memory; failure or cancellation preserves the effective context. Redeven adds
no summary generator, batching policy, or durable compaction state.

The 50,000-token target guides tail selection; it does not require a fixed-length summary or fill unused budget. The actual result combines the generated summary, preserved user requirements, retained complete tail, and checkpoint structure. The summary has a ceiling, so the result may be substantially below the target. Protecting the latest complete input or tool exchange can also exceed the target; Floret records that pressure instead of clipping those messages. The divider reports estimated message context after installation, independently of system-prefix and tool-definition tokens in a complete provider request.

## Projection and usage

Workspace live frames and bootstrap/reconnect use the same public canonical context reader. Redeven neither stores compaction lifecycle records nor accumulates usage. Floret supplies `AfterItemID`; Redeven uses that exact anchor and stable operation identity for one divider. Empty history has no invented anchor and displays a noop notice. Fork, pagination, refresh, and reconnect preserve canonical operation identity.

Native usage remains preferred to estimates. After its invalidation, the composer displays the installed estimate with the estimated tone.

The context panel shows measured input and model capacity, with an approximation mark when only an estimate is available. A capacity bar separates used input and remaining capacity. Budget thresholds, output limits and explanatory blocks stay out of this compact popup. The [source breakdown](flower-managed-model-context.md#presentation) uses request-scoped tool origins and canonical section weights from Floret v7.47.1, with horizontal bars and flat source details. Displayed category amounts proportionally allocate the same request's used-context total and carry an approximation mark. Current snapshot character counts never substitute for missing request data. Latest and cumulative cache rates remain in the compact footer.

Cumulative thread totals survive installation. Cache hit rate is `cache_read / (input + cache_read + cache_write)` over those disjoint buckets. Pressure supplies only actionable warnings. No host watermark or second ledger is retained.

Run input limits remain cumulative Floret `TurnLimits.MaxInputTokens`. Explicit output limits also supply context headroom; otherwise the resolved model capability supplies headroom while the provider request retains its normal unset output option. Redeven does not invent a total budget or infer serving capacity from model weights.

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
- `redeven:internal/ai/run_e2e_deepseek_compaction_acceptance_test.go` - Four real provider lanes.
- `redeven:scripts/check_flower_context_deepseek.sh` - Mandatory opt-in acceptance entry point.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.compaction.browser.test.tsx` - Dedicated embedded command and draft/navigation interaction.
- `redeven:internal/envapp/ui_src/scripts/checkFlowerCompactionRuntime.mjs` - Built Runtime and real provider canvas qualification.
- `redeven:internal/flower_ui/src/chat/flowerContextPresentation.ts` - Canonical usage and localized noop presentation.
