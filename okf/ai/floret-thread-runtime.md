---
type: AI Runtime Contract
title: Floret thread runtime integration
description: Canonical thread reads, titles, turn admission, attachments, and published Floret ownership.
tags: [ai, floret, threads, runtime]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

- Authority: published Floret owns every admitted user/assistant message, attachment reference, title, turn/run lifecycle, projection, control signal, approval, todo, context, SubAgent relationship, and opaque provider state.
- Outcome: Redeven combines host `ThreadSettings` with one Floret `ReadThreadOverview` result and maps that canonical snapshot into Flower.
- Invariants: Redeven never queries Floret storage, stores a second Agent lifecycle, guesses missing canonical state, or converts attachments into filename text.
- Failure boundary: a missing/corrupt Floret thread, invalid attachment, permission refresh failure, or invalid public snapshot aborts the request before the affected provider/tool action.

# Contract

## Canonical reads and titles

Thread list and detail pagination may be driven by Redeven endpoint and pin settings, but every row must resolve through Floret `ReadThreadOverview`. The overview supplies the thread title, creation/update times, status, latest run, through ordinal, and latest admitted turn from one active journal path. Missing or damaged canonical state is an error; Redeven does not skip rows, rebuild state from settings, or merge settings timestamps into Agent lifecycle time.

All production hosts use `ThreadTitleModeProvider`. Provider-generated titles remain Floret policy. Manual rename, create-time explicit title, fork-time explicit title, and schema-v2 title migration call Floret `SetThreadTitle`; Redeven has no title worker, retry state, placeholder title, preview-derived title, or title column. Floret's valid empty pre-title state is projected as Flower's internal `unset` presentation status; explicit `pending`, `ready`, and `failed` values remain unchanged, while every other value fails the UI contract.

## Admission and attachments

Before admission, Redeven may persist one queued command containing prompt text, launch options, session identity, and upload references. Attachments are normalized to Floret `MessageAttachment` values containing only an opaque, content-addressed `redeven-upload:` resource reference, name, MIME type, and byte size. Attachment-only turns are valid; empty text with no attachments is rejected.

Replacing a queued or draft followup is one Redeven transaction. The source row must exist and remain `ready`; the destination command, selected upload references, source deletion, cleanup candidates, and one queue-revision increment commit together. A missing, already consumed, in-flight, or conflicting source fails explicitly. Redeven never creates a destination and then performs best-effort source cleanup, so a lost response cannot duplicate queued commands.

Redeven preflights each current queued attachment before creating the Floret turn host: the upload must be owned by that exact queued command, metadata must match, the physical file must exist at the declared size, and the selected model/provider route must support the content type and MIME. The bytes are read once, frozen for the current provider dispatch, hashed, and the hash is embedded in the opaque canonical resource reference. Queue drain reuses the existing command row and its exact TurnID/RunID/resource ownership; it does not create a replacement command for admission. A known execution failure before Floret admission creates no canonical turn or provider request and releases the command as a non-retrying draft. Immediately before the run can admit, the command enters durable `in_flight` state; update, delete, reorder, bulk stop recovery, and resource cleanup are rejected.

Published Floret v0.23.0 persists the complete canonical user entry before emitting its validated `thread_entry_committed` event, and provider, assistant, and tool events follow that admission boundary. Redeven reacts to that event with one product handoff: it transfers upload ownership to the thread and removes the unadmitted command, publishes a thread summary and one `timeline.replaced` snapshot rebuilt through public `ListThreadTurns`, then completes an in-memory one-shot admission signal carrying only the exact TurnID, RunID, and outcome. A `kind=start` response is not returned before this sequence. If canonical presentation fails after Floret admission, the exact admitted identity still completes the receipt so the caller cannot duplicate the turn, while assistant presentation remains blocked and the run fails the contract. Redeven never reconstructs the user row from the command, audit, prompt, or upload metadata.

Run-end reconciliation checks the exact opaque `TurnID`: an admitted command is settled to thread ownership, while every known unadmitted execution failure becomes a draft. Before startup reopens runtime authority, restart reconciliation performs the same exact canonical check for every queued command: an admitted command settles, while an `in_flight` command with no canonical turn is atomically released to queued `ready` through its complete command, turn, and run identity. Any read or settlement failure fails startup recovery before any queued thread is woken. A missing command row is an error because Redeven has no admitted TurnID/RunID mapping that could prove a previous settlement.

Provider projection resolves canonical attachments only from exact host ownership. The current turn consumes the frozen pre-admission bytes. Historical root projection rereads the root thread-owned upload and verifies its canonical digest. A `full_path` SubAgent may resolve an inherited attachment only through its canonical parent and verified fork mode; mission-only children cannot read parent resources. Unsupported capability, MIME, route, ownership, metadata, digest, file, or read state is explicit. Floret never receives Redeven URLs, bytes, base64, or filesystem paths, and Redeven never degrades a failed attachment into its filename.

## Runtime ownership

Root turn, SubAgent, and compaction gateway hosts receive the same Redeven-resolved reasoning capability, including an explicit `none` capability when reasoning is unsupported. Floret owns short-request reasoning selection and the automatic-title lifecycle. Redeven maps the resolved public capability and transports each request-level selection without provider-catalog fallback or inheritance from the main turn.

One Floret SQLite Store is opened only inside `floret_bootstrap.go`. Published Floret v0.23.0 capabilities are minted from a composition-root-only `HostBootstrap`; `Service` never retains that aggregate authority. The composition root issues responsibility-specific create, title, fork, delete, read, runtime, and recovery capabilities. Root run and product capability structs have exact field allowlists. Child reads require canonical membership plus finalized audit, root reads cannot inspect child journals, and policy-only objects cannot dispatch effects. Only the durable create coordinator holds `CreateThread`; ordinary operations require an existing canonical journal and preserve Floret's missing, deleted, busy, and stale-authority failures. Floret loads journal context and opaque continuation internally; Redeven supplies current structured input, product supplemental context, provider adapter, tools, effect authorization, and host labels.

Interrupted-turn recovery is startup-only. Pending deletes and creates are replayed before recovery targets are enumerated. Composition produces Floret v0.23.0 recovery factories already bound to exact root or parent-child identity and durable proof; neither `Service` nor ordinary runtime retains arbitrary-id recovery binders. Ordinary binding remains closed until interrupted turns, pending forks, and pending SubAgent publications settle in order. Fresh busy or stale authority is retried without lease theft; missing or corrupt canonical authority fails startup. Redeven does not recover pending PTY tool settlement across restart because process ownership is not durable.

Redeven persists only product placement in `ai_flower_thread_routing`: endpoint/thread identity, home runtime, runtime kind, origin environment, primary target, active target ids, and update time. These fields select Redeven execution placement and product target policy; they do not describe an Agent. Owner, parent, context, and action fields are forbidden. Root thread views omit those fields, while child membership and parent identity are projected read-only from Floret `ListSubAgents` and `ReadSubAgentDetail`. Schema migration discards shadow-only legacy rows and retains only non-empty product routing.

Pending terminal work binds the exact settlement target derived from the creating turn or SubAgent capability before the process starts. The target includes the Floret effect-attempt identity delivered through the one-shot invocation proof. While the owning `RunTurn` is active, only that turn or SubAgent Host may settle the pending result. If PTY completion is finalized after the exact `RunTurn` returns, a one-way authority barrier must first publish its validated terminal result; only then may the post-terminal recovery coordinator mint one root-bound or parent-bound `PendingToolRecoveryHost` and perform one settlement attempt. Active execution never receives a recovery factory, a missing barrier is a construction error, and Redeven does not retry `ErrThreadBusy`, poll for authority, switch between root and SubAgent hosts, inspect Floret storage, or guess a Host.

Create, fork, and delete use explicit durable cross-store coordinators because no transaction spans Floret and Redeven. Their snapshots contain product settings, resources, routing, and user intent only. Per-thread lifecycle gates prevent canonical admission from interleaving with immutable product intent. The detailed replay, retirement, fingerprint, and cleanup contracts are owned by [Flower thread fork coordination](flower-thread-fork-coordination.md) and [Flower thread deletion coordination](flower-thread-deletion-coordination.md).

A SubAgent publication is replayable only while its durable state is `pending`. A non-retryable publication or identity failure moves it to terminal `failed` and clears the persisted request/session/model payload just as commit does; neither startup nor later spawn retries can replay or overwrite that failed intent.

# Boundaries

Redeven must not import Floret `internal/*`, open or query Floret-managed tables, reconstruct provider-visible history, or persist mapped Agent messages, attachments, titles, status, ordinals, approvals, todos, context, SubAgent membership, tool state, or provider state. Local `replace`, `go.work`, sibling checkout paths, copied contracts, and unpublished Floret commits are forbidden.

# Evidence

- `redeven:internal/ai/threads.go:124` - Thread reads obtain canonical Floret overview and latest-turn state through the public read host.
- `redeven:internal/ai/threads.go:57` - Thread views combine supplied canonical state with Redeven host settings.
- `redeven:internal/ai/thread_create_operation.go:33` - Create replay creates the Floret thread and explicit title before committing settings.
- `redeven:internal/ai/floret_attachments.go:177` - Structured turn input freezes bytes and carries content-addressed opaque attachment references.
- `redeven:internal/ai/floret_runtime.go:165` - Linked references and turn-only supplemental context are mapped before admission.
- `redeven:internal/ai/floret_runtime.go:173` - Attachment validation completes before Floret turn admission.
- `redeven:internal/ai/floret_provider.go:365` - Canonical attachments become real provider content parts without text fallback.
- `redeven:internal/ai/floret_events.go:42` - Canonical user-entry admission settles queued ownership.
- `redeven:internal/ai/queued_turns.go:124` - Restart reconciliation checks exact Floret turn identity.
- `redeven:internal/ai/threadstore/uploads.go:381` - Followup replacement commits destination, resource ownership, source consumption, and revision atomically.
- `redeven:internal/ai/thread_actor.go:149` - Per-thread lifecycle gates serialize admission registration with durable fork/delete intent.
- `redeven:internal/ai/floret_bootstrap.go:265` - Composition creates responsibility-specific Floret binders without exposing Store or bootstrap tokens.
- `redeven:internal/ai/floret_startup_recovery.go:38` - Startup enumerates exact root and parent-child interrupted-turn recovery targets.
- `redeven:internal/ai/floret_startup_recovery.go:103` - Startup recovery gates ordinary runtime binding until canonical recovery completes.
- `redeven:internal/ai/floret_startup_recovery.go:274` - Ordinary runtime explicitly rejects use while recovery is pending or failed.
- `redeven:internal/ai/agent_authority_boundary_test.go:20` - Exact field allowlists prevent run capability growth and root-to-child leakage.
- `redeven:internal/ai/threadstore/flower_records.go:15` - Product routing has no Agent owner, parent, context, or action fields.
- `redeven:internal/ai/threadstore/product_migrations.go:14` - Schema migration removes legacy Agent shadows and retains non-empty product routing.
- `redeven:internal/ai/threadstore/subagent_publication.go:190` - Failed SubAgent publications become terminal and clear replay payloads.
- `redeven:internal/ai/terminal_process.go:858` - Post-terminal process settlement waits for the exact RunTurn authority barrier before recovery settlement.
- `redeven:internal/ai/floret_bootstrap.go:50` - The composition-root recovery coordinator mints one exact root or parent-bound pending-tool recovery host.
- `redeven:go.mod:9` - Redeven consumes the published Floret module.
