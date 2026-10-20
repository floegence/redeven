---
type: AI Interaction Contract
title: Flower context compaction and Goal continuation
description: Explicit compaction intent, one upstream execution owner, and recoverable interaction.
tags: [ai, flower, goals, context, compaction, recovery]
timestamp: 2026-10-20T00:00:00Z
---
# Summary

Published Floret v7.74.0 owns compaction admission, installation, Goal continuation,
Stop, Retry and restart. Redeven authorizes and transmits the frozen intent and
presents canonical state. Pure compaction ends after installation or noop; Goal
continuation prepares context and continues work through the existing Engine and
current Goal review in the same execution.

# Contract

## Explicit manual intent

`POST /_redeven_proxy/api/ai/threads/{id}/context/compact` accepts `storage_generation`, `client_request_id` and optional `continue_goal`. Omitted or false preserves pure compaction. True selects `goal_continuation` only when Floret finds an active canonical Goal during admission. The handler verifies endpoint authority, generation, and the frozen model configuration, then invokes optional public `ThreadContextCompactor.CompactContext`. Admission returns HTTP 202 before model preparation or provider work. Floret admits only idle threads with no queued input or unresolved interaction; its explicit `context_compaction` or `goal_continuation` turn carries real TurnID and RunID without a fabricated user message.

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

# Boundaries

Floret exclusively owns canonical compaction and Goal execution. Redeven has no
summary generator, second lifecycle or automatic wakeup. [Usage and presentation](model-context-usage-and-compaction.md) maps upstream facts; [qualification](../operations/flower-compaction-qualification.md) defines isolated runtime and provider checks.

# Evidence

- `redeven:internal/ai/compact_thread_context.go` - Authorized asynchronous admission through published Floret.
- `redeven:internal/ai/compact_thread_context_test.go` - Canvas Send rejection, preparation, replay, Goal intent and authorization.
- `redeven:internal/codeapp/appserver/server_ai_compaction_test.go` - HTTP admission and strict request boundary.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Command selection, outbox delivery and canonical recovery.
- `redeven:internal/flower_ui/src/transportOutbox.test.ts` - Frozen intent and unchanged legacy entries.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.compaction.browser.test.tsx` - Embedded command, draft, navigation and continuation recovery.
