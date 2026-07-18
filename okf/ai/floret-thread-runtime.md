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

Before admission, Redeven may persist one queued command containing prompt text, launch options, session identity, and upload references. Attachments are normalized to Floret `MessageAttachment` values containing only an opaque `redeven-upload:` resource reference, name, MIME type, and byte size. Attachment-only turns are valid; empty text with no attachments is rejected.

Redeven preflights each current queued attachment before `RunTurn`: the upload must be owned by that exact queued command, metadata must match, the physical file must exist at the declared size, and the selected model/provider route must support the content type and MIME. Failure leaves the command queued, creates no Floret turn, and sends no provider request. After Floret emits the validated canonical user-entry event, one Redeven transaction changes upload ownership from queued command to thread ownership and removes the queued prompt. Restart reconciliation checks the exact opaque `TurnID` through `ListThreadTurns` before performing the same idempotent settlement.

Provider projection resolves canonical attachments only from thread-owned uploads. The host reads the resource and produces the provider image/file content part; unsupported capability, MIME, route, missing ownership, metadata mismatch, missing file, or read failure is explicit. Floret never receives Redeven URLs, bytes, base64, or filesystem paths, and Redeven never degrades a failed attachment into its filename.

## Runtime ownership

One Floret SQLite Store is opened per AI Service and shared by ordinary turns, idle compaction, SubAgents, and provider-free maintenance hosts. Redeven interacts through published `github.com/floegence/floret` v0.12.0 APIs only. Floret loads journal context and opaque continuation internally; Redeven supplies current structured input, product supplemental context, provider adapter, tools, permission decisions, and host labels.

Create, fork, and delete are explicit durable cross-store coordinators because no transaction spans both stores. Their operation snapshots contain host settings, resources, and user intent only; they never copy canonical title, lifecycle, turn, run, or projection data. The focused coordination concepts own their replay ordering.

# Boundaries

Redeven must not import Floret `internal/*`, open or query Floret-managed tables, reconstruct provider-visible history, or persist mapped Agent messages, attachments, titles, status, ordinals, approvals, todos, context, SubAgent membership, tool state, or provider state. Local `replace`, `go.work`, sibling checkout paths, copied contracts, and unpublished Floret commits are forbidden.

# Evidence

- `redeven:internal/ai/threads.go:53` - Thread views combine host settings with one canonical Floret overview.
- `redeven:internal/ai/thread_create_operation.go:15` - Create replay ensures the Floret thread and explicit title before committing settings.
- `redeven:internal/ai/floret_attachments.go:42` - Structured turn input carries opaque attachment references and performs strict resource projection.
- `redeven:internal/ai/floret_runtime.go:193` - Attachment validation completes before Floret turn admission.
- `redeven:internal/ai/floret_provider.go:335` - Canonical attachments become real provider content parts without text fallback.
- `redeven:internal/ai/floret_events.go:42` - Canonical user-entry admission settles queued ownership.
- `redeven:internal/ai/queued_turns.go:27` - Restart reconciliation checks exact Floret turn identity.
- `redeven:go.mod:9` - Redeven consumes the published Floret module.
