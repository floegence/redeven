---
type: AI Runtime Contract
title: Flower subagent parent events
description: Canonical parent reports, passive lifecycle events, and bounded waiting.
tags: [ai, floret, subagents, events]
timestamp: 2026-10-21T00:00:00Z
---
# Summary

SubAgent reports and lifecycle events remain canonical Floret facts, visible to the direct parent without creating another handoff store. They do not wake idle parents; bounded waiting and explicit reads expose reports when the parent continues. Tool approval and user input remain ordinary child interactions, while questions and blockers can be reported through `report_to_parent` without ending the delegated task.

# Contract

Flower enables published Floret v7.49.0 parent events. The child-only
`report_to_parent({message})` accepts nonempty UTF-8 text up to 8 KiB. Invocation
identity comes from the exact authorized tool call; Floret derives its direct
parent. Readonly children may report to that parent without gaining routing,
input-response, approval, or filesystem rights. Success returns `accepted`,
a stable event ID and parent ThreadID, without ending the child mission.
The tool description carries the child-parent relationship, reporting purpose,
automatic completion notification, and full-result reading instructions; the
shared Flower introduction does not duplicate this communication contract.

Floret atomically records references for completion, failure, cancellation,
interruption, normalized execution timeout and input/approval attention alongside
their canonical source. Ordinary running/queued changes, counts, message previews
and status-read failures produce no automatic message. A wait deadline is only
`wait_timeout`, never evidence of execution timeout. Completion does not copy a
final handoff; failures contain reason codes rather than raw error strings.

Received events stay in the canonical journal until the next natural logical
provider boundary. Floret pairs complete tool calls/results first, admits one
typed bounded projection, then applies request budgeting, compaction and freezing.
Idle, stopped, naturally ended and human-waiting parents stay passive. No Send,
Steer, timer, host receipt ledger or uncertain-effect replay delivers events.
Resolved interactions no longer claim action is required. Admission means context
placement, never proof of model reading. Retry, restart, fork and compaction use
the same upstream projection. Domain 18→19 migration retains older history;
opt-in bootstraps current unresolved interactions once without old terminal backfill.

Each automatic item is bounded to 2 KiB / 512 estimated tokens; each admitted
batch to 8 KiB / 2,048. Explicit reports preview at most 512 UTF-8 bytes. Overflow
uses a fixed full-event range and requires explicit review before claiming all
delegated work is reviewed. `subagent_events` lists metadata or reads one event
or a fixed closed range with explicit pagination, preserving complete report text.
These are engineering limits, not measured context savings.

Published Floret v7.50.0 optional `ThreadWaiter` owns bounded waiting.
Redeven maps its selected snapshots and `completed`, `attention_required`,
`missing`, `events` and `wait_timeout` outcomes; it has no subscription/read
loop. Omitted targets freeze at wait start. Missing children never count as
completed. Cancellation and Host shutdown retain their own errors. A normal
single deadline may repeat without a cumulative limit; only a successful,
nonempty wait that actually used its deadline receives bounded-wait metadata.
Engine alone evaluates every call in a repeated batch, so waits cannot exempt
side effects or polling with unchanged progress. Full handoffs remain intact.

Child approval/input pauses the parent through the completed tool's canonical
InputRequired interaction. The shared UI opens the child in the ordinary chat
interaction surface, provides Return to parent, and requires deliberate parent
continuation after handling the request or using available results. Stop and
navigation remain available. No passive event wakes an idle or failed parent.

The compact [event panel](../ui/flower-subagent-detail.md) shows source, kind,
received versus added-to-context state, full read and source navigation. Both
Env App and Desktop use an authorized recipient route with explicit pagination.
The browser keeps only temporary reading/disclosure state.

# Boundaries

Events are observations and context inputs, not a second result store or a background scheduling mechanism. Read complete reports through `subagents inspect` or `wait` when needed; completion events contain no final report. Task and execution authorization remain in the original `message`; see [Subagent runtime](subagent-runtime.md).

# Evidence

- `redeven:internal/ai/parent_events_test.go` - Covers scoped reports, lifecycle references, bounded reads, waits and input attention.
- `redeven:internal/ai/subagents_handoff_test.go` - Verifies complete child handoffs.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Presents parent events and canonical child current views.
