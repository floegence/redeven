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

All production hosts use `ThreadTitleModeProvider`. Provider-generated titles remain Floret policy. Manual rename, create-time explicit title, fork-time explicit title, and schema-v2 title migration call Floret `SetThreadTitle`; Redeven has no title worker, retry state, placeholder title, preview-derived title, or title column.

## Admission and attachments

Before admission, Redeven may persist one queued command containing prompt text, launch options, session identity, and upload references. Attachments are normalized to Floret `MessageAttachment` values containing only an opaque, content-addressed `redeven-upload:` resource reference, name, MIME type, and byte size. Attachment-only turns are valid; empty text with no attachments is rejected.

Replacing a queued or draft followup is one Redeven transaction. The source row must exist and remain `ready`; the destination command, selected upload references, source deletion, cleanup candidates, and one queue-revision increment commit together. A missing, already consumed, in-flight, or conflicting source fails explicitly. Redeven never creates a destination and then performs best-effort source cleanup, so a lost response cannot duplicate queued commands.

Redeven preflights each current queued attachment before creating the Floret turn host: the upload must be owned by that exact queued command, metadata must match, the physical file must exist at the declared size, and the selected model/provider route must support the content type and MIME. The bytes are read once, frozen for the current provider dispatch, hashed, and the hash is embedded in the opaque canonical resource reference. Failure leaves the command queued, creates no Floret turn, constructs no turn host, and sends no provider request. Immediately before the run can admit, the command enters durable `in_flight` state; update, delete, reorder, bulk stop recovery, and resource cleanup are rejected. Run-end reconciliation checks the exact opaque `TurnID`: an admitted command is settled to thread ownership, an unadmitted retryable command returns to queued `ready`, and an unadmitted user-canceled command becomes a draft. After Floret emits the validated canonical user-entry event, one Redeven transaction changes upload ownership from queued command to thread ownership and removes the queued prompt. Restart reconciliation performs the same exact identity check before settlement. A missing command row is an error because Redeven has no admitted TurnID/RunID mapping that could prove a previous settlement.

Provider projection resolves canonical attachments only from exact host ownership. The current turn consumes the frozen pre-admission bytes. Historical root projection rereads the root thread-owned upload and verifies its canonical digest. A `full_path` SubAgent may resolve an inherited attachment only through its canonical parent and verified fork mode; mission-only children cannot read parent resources. Unsupported capability, MIME, route, ownership, metadata, digest, file, or read state is explicit. Floret never receives Redeven URLs, bytes, base64, or filesystem paths, and Redeven never degrades a failed attachment into its filename.

## Runtime ownership

One Floret SQLite Store is opened only inside `floret_bootstrap.go`. Published Floret v0.19.0 capabilities are minted from a composition-root-only `HostBootstrap`; the aggregate bootstrap result is not retained by `Service`. The composition root converts create, title, fork, and delete binders into responsibility-specific coordinator authorities, keeps canonical reads in a dedicated read holder, and exposes ordinary runtime through a dedicated runtime issuer. Root run host and product capability structs have exact field allowlists enforced by tests and the dependency-boundary script. Current-run permission reads are owner-bound; canonical child reads validate finalized audit and child identity. A child receives no queued-upload, child-audit enumeration, publication, model, presentation, or further derivation capability. Terminal cleanup obtains a new exact child execution capability after canonical membership and audit validation instead of querying child process resources by arbitrary ids. Policy-only child objects cannot dispatch effects. The durable create coordinator is the only production path that holds `CreateThread`; ordinary turns, queue drain, compaction, fork, rename, and SubAgent operations require an existing canonical journal and return Floret's missing, deleted, busy, or stale-authority error without recreating it. Root reads cannot inspect child journals. Floret loads journal context and opaque continuation internally; Redeven supplies current structured input, product supplemental context, provider adapter, tools, effect authorization, and host labels.

Interrupted-turn recovery is a startup-only coordinator. Every pending delete page is replayed before recovery-target enumeration; startup fails closed if canonical/product deletion has not removed the settings that would otherwise become a recovery target. Pending creates are then recovered before canonical recovery targets are enumerated. During composition, the root and parent-child recovery binders are used once to produce an immutable list of Floret v0.19.0 recovery factories, each already bound to the exact root or parent-child identity and durable recovery proof. The retry goroutine retains only those exact factories; `Service` and ordinary runtime do not retain arbitrary-ID recovery binders. Ordinary runtime binding remains closed while interrupted turns, then pending forks, then pending SubAgent publications are unresolved. Publication replay rebuilds and installs the active host adapter from that operation's persisted host configuration before idempotent spawn, drains every pending batch, and keeps child callbacks bound to the recovered host. Fresh busy or stale authority is retried without stealing the lease, while missing or corrupt canonical authority fails startup. Redeven does not mint pending-tool recovery because PTY/process settlement ownership is not durable across restart.

Pending terminal work binds the active settlement target derived from the creating turn or SubAgent capability before the process starts. The target includes the exact Floret effect-attempt identity delivered through the one-shot invocation proof. When that active authority ends, settlement fails with the Floret active-authority error; Redeven does not switch to a recovery handle, look up another run, or guess a Host.

Create, fork, and delete are explicit durable cross-store coordinators because no transaction spans both stores. Their operation snapshots contain host settings, resources, and user intent only; they never copy canonical title, lifecycle, turn, run, or projection data. Per-thread lifecycle admission is serialized: a run or idle compaction must verify writable settings and register itself before releasing the gate, while rename keeps its writable check and Floret title write under that same gate. Fork and delete first settle every queued command whose exact `TurnID` already exists in Floret, then persist durable intent. Force delete cancels or detaches active work only after intent persistence succeeds. Whichever side establishes first makes the other fail explicitly, so canonical admission cannot interleave with an immutable product snapshot.

A persisted delete intent retires the thread id and atomically rejects later settings, queue, upload ownership, fork, and Flower routing writes; delete replay alone may treat a missing canonical thread as idempotent success. A pending fork likewise freezes source settings, queue admission, upload ownership, permission audit, and routing writes until its immutable product snapshot commits. Fork and delete snapshots carry full-payload fingerprints in addition to request identity. Operation and queued-command JSON accept only the current strict single-value shape; unknown fields, trailing values, schema/identity mismatch, request-fingerprint mismatch, snapshot-fingerprint mismatch, invalid lane, or invalid admission state fails before Floret effects. Persisted queue lanes accept only `queued` and `draft`, and admission state accepts only `ready` and `in_flight`.

A SubAgent publication is replayable only while its durable state is `pending`. A non-retryable publication or identity failure moves it to terminal `failed` and clears the persisted request/session/model payload just as commit does; neither startup nor later spawn retries can replay or overwrite that failed intent.

# Boundaries

Redeven must not import Floret `internal/*`, open or query Floret-managed tables, reconstruct provider-visible history, or persist mapped Agent messages, attachments, titles, status, ordinals, approvals, todos, context, SubAgent membership, tool state, or provider state. Local `replace`, `go.work`, sibling checkout paths, copied contracts, and unpublished Floret commits are forbidden.

# Evidence

- `redeven:internal/ai/threads.go:53` - Thread views combine host settings with one canonical Floret overview.
- `redeven:internal/ai/thread_create_operation.go:15` - Create replay creates the Floret thread and explicit title before committing settings.
- `redeven:internal/ai/floret_attachments.go:42` - Structured turn input freezes bytes and carries content-addressed opaque attachment references.
- `redeven:internal/ai/floret_runtime.go:193` - Attachment validation completes before Floret turn admission.
- `redeven:internal/ai/floret_provider.go:335` - Canonical attachments become real provider content parts without text fallback.
- `redeven:internal/ai/floret_events.go:42` - Canonical user-entry admission settles queued ownership.
- `redeven:internal/ai/queued_turns.go:27` - Restart reconciliation checks exact Floret turn identity.
- `redeven:internal/ai/threadstore/uploads.go:377` - Followup replacement commits destination, resource ownership, source consumption, and revision atomically.
- `redeven:internal/ai/thread_actor.go:35` - Per-thread lifecycle gates serialize admission registration with durable fork/delete intent.
- `redeven:internal/ai/floret_bootstrap.go:107` - Composition creates responsibility-specific Floret binders without exposing Store or bootstrap tokens.
- `redeven:internal/ai/floret_startup_recovery.go:20` - Startup alone owns interrupted-turn recovery and gates ordinary runtime binding.
- `redeven:internal/ai/agent_authority_boundary_test.go:17` - Exact field allowlists prevent run capability growth and root-to-child leakage.
- `redeven:internal/ai/threadstore/subagent_publication.go:190` - Failed SubAgent publications become terminal and clear replay payloads.
- `redeven:go.mod:9` - Redeven consumes the published Floret module.
