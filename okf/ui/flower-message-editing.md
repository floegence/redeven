---
type: UI Contract
title: Flower latest user message editing
tags: [flower, composer, revisions, history]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Edit the latest eligible user message in the existing composer. Opening the editor is read-only. Sending creates an immutable replacement branch inside the same thread, preserving the original version. Floret owns conversation admission and history; Redeven owns authorization, resource preparation and presentation.

# Contract

## Interaction

The latest canonically eligible user row exposes a pencil action. The existing composer becomes the editor, containing its complete text, captured references and admitted attachments. Keep the interface to one input control and its existing action row: no additional heading, instruction banner or duplicate Stop control. Cancel is a compact accessible X beside Send; Escape cancels. Preserve the ordinary unsent draft independently and restore it after cancellation or confirmed submission.

Editing remains local until Send. For a running turn, Send means stop the exact source turn gracefully, recheck authority and submit the replacement. Opening, typing, inspecting previous versions and canceling never stop execution. Waiting-input interactions use the same edit submission path; Enter does not answer the old question. IME composition never submits. Slash-prefixed replacement text remains literal. Reference suggestions retain their ordinary keyboard behavior; prompt-history recall does not replace an edit draft.

A clock action opens the previous version read-only. Use this version restores its input into the editor and still requires Send. Switching threads retains each independent draft; late responses update only their originating edit. Read-only surfaces expose no edit capability.

## Canonical ownership and admission

Consume published Floret v7.111.3's optional `runtime.ThreadMessageEditor`. The request identifies the thread, source item, exact complete expected input and an immutable request key. Floret validates eligibility, cancels if explicitly requested, and atomically appends the revision boundary, new turn marker and replacement user entry. Original journal bytes remain intact. Execution uses the normal provider pipeline with fresh TurnID/RunID and an explicit prompt-lineage boundary; superseded responses never leak into the new model context.

The latest source is not guessed from a visible text match. Applied steering, Goal submission, unknown effects, outstanding bound host work and open children from the discarded turn can make the source ineligible. No automatic tool replay, child cancellation, file rollback or fallback to an older input is permitted. Goal, Todo, queue and accumulated usage survive; deleted-Goal suppression names the replacement input consistently in full and bounded reads, after restart and Fork. Host shutdown fences replacement admission after the asynchronous Stop transition.

Floret domain migration 37 to 38 and logical storage fence 12 to 13 preserve the released migration lineage. Hosts treat these records as opaque; there is no Redeven transcript or lifecycle mirror. Fork provenance never authorizes reading another thread's revision history.

## Product transport and resources

`GET /_redeven_proxy/api/ai/threads/:id/message-edit` returns the canonical draft, full-input fingerprint and storage generation. The optional single `revision_request_key` selects an immutable historical version. `POST` submits a strict JSON command with source identity, frozen generation, stop intent, optional restoration key and complete edited content.

Both Env HTTP and Desktop IPC require fresh product authorization. Desktop allows only exact GET/POST methods and exact bounded history query parameters. RWX and interactive endpoint authority are required. Captured reference text remains intact; retained resource IDs must belong to the selected original or restored input. New uploads use the existing scoped staging capability in headers/IPC metadata, never in the JSON body. Runtime facts, opaque resource locators, credentials and supplemental context never enter draft/history DTOs.

The immutable command includes every retained and added resource. Canonical lookup precedes resource preparation on replay. Same-key identical payload returns the original acknowledgement; changed payload, stale source or changed storage generation fails. Confirmed admission does not depend on a subsequent UI refresh.

The v7.111 dependency also introduces the explicit provider-context v12 boundary for interruption history. Upgrade acceptance preserves canonical prose, immutable released fixtures and native fragments when their canonical prefix is unchanged. Changed interruption context resets incompatible state; newly produced native fragments survive restart and remain isolated from Fork.

## Failure handling

A rejected request keeps the editable draft and displays the actual error. A lost response or 5xx result freezes the exact payload and key; explicit Retry resends that command once per user action. No hidden retry, new key, cancellation or resource removal can discard an unresolved command. Detached UI state does not authorize task replay. Edit drafts are browser presentation state, not a durable pending engine operation; process restart never automatically resubmits them.

History lookup is explicit and can read the complete retained source projection; ordinary live token updates do not reload eligibility or history. Eligibility refreshes only when selected thread, latest user identity, status, access or confirmed edit changes. The version dialog presents the prior source turn rather than inserting its output into the live thread.

# Decisions and comparative evidence

The comparison uses pinned source snapshots, not a claim about the latest binaries:

- Codex `ba0d0e1f74ee0f41c27ef24b37ed5fc030b487e7`, `codex-rs/tui/src/app_backtrack.rs`: backtrack previews select a user prompt, request revert-before-turn, and restore the prompt into the composer. Flower adopts composer reuse and explicit selection, while postponing canonical mutation until Send so cancel is genuinely local.
- OpenCode v2.0.32 `843a6c514e606b436a7fe713422ace0a93ad3d61`, `packages/core/src/session.ts`: separates revert stage, clear and commit. Flower uses one atomic revision admission instead of adding an independently durable staged-revert lifecycle.
- DeepSeek Harness `ce7073d51254c26cd63b22a60835b8f948deb447`, `packages/client/ui-chat/src/client/apply.ts`: branches at an explicit sequence and opens the child session. Flower retains immutable historical provenance but keeps latest-message editing in the existing thread; explicit Fork remains a separate user action.

Non-goals: editing arbitrary older messages, undoing real tool side effects, branch trees in the composer, automatically replaying failed tools, or changing Goal/queue semantics. These would require independent product decisions.

# Boundaries

Opening, inspecting or cancelling an edit is read-only. Only explicit Send stops the exact source execution and submits an immutable replacement. Floret owns conversation history; Redeven never rewrites canonical records or silently resubmits stale edits.

# Evidence

- [Product service and source validation](../../internal/ai/message_edit.go), [service regressions](../../internal/ai/message_edit_test.go).
- [Real HTTP acceptance](../../internal/codeapp/appserver/server_ai_message_edit_test.go): opening during execution, strict payloads, graceful replacement, same-key replay, stale/conflicting input, version reads and permissions.
- [Browser interaction](../../internal/envapp/ui_src/src/ui/FlowerSurface.messageEdit.browser.test.tsx): draft restoration, active/waiting turns, literal slash text, exact retry, references/attachments, mobile IME and delayed thread-switch responses.
- [Shared adapter](../../internal/flower_ui/src/runtimeFlowerSurfaceAdapter.test.ts), [Desktop allowlist](../../desktop/src/main/runtimeFlowerRoutes.test.ts), [Desktop transport](../../desktop/src/welcome/flower/localEnvironmentFlowerSurfaceAdapter.client.test.tsx), [Env transport](../../internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.test.ts).
- [Submission and recall](flower-turn-launcher.md), [long-thread acceptance](../operations/flower-long-thread-gate.md).
