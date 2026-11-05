---
type: AI Runtime Contract
title: Context usage, measurement and compaction
tags: [ai, models, context, compaction]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Floret owns confirmed usage, pressure, bounded compaction and canonical installation; Redeven maps independent token, byte and image evidence. Full input and frozen attempt identity constrain measurement. Manual compaction is explicit intent, while unavailable historical evidence remains unknown.

# Contract

## Usage and recovery
### Evidence and projection
Lifecycle evidence may retain frozen trigger candidates, pressure and validated replacement. Floret installs complete actor-owned context before publishing its version. Changed context bypasses text cadence; equal snapshots coalesce text in bounded queues. Redeven neither accumulates usage nor reconstructs lifecycle facts, invents budgets or infers capacity from weights.

### Independent capacity evidence
Published Floret v7.94.0 supplies optional typed request-byte and image-capacity evidence alongside
compaction decisions. Host preparation failures include exact actual/limit byte
counts; server HTTP 413 carries no guessed counts. Both can occur while the last
measured token ratio is low. The indicator retains that confirmed ratio, while
the divider explains the independent capacity cause and message-text estimate.
Cause-only events, reloads and Desktop RPC retain this distinction. Historical
records without this evidence remain unknown; no error-text inference is used.

Aggregate image evidence carries exact image counts or decoded bytes, with
preparation/response stage; counts never occupy byte or token fields. Desktop
RPC v6 reconstructs the typed upstream cause before Engine recovery; older peers
are rejected at the version handshake. During recovery
the inline divider says “Organizing image history…” in every shipped locale and
shows measured cause details. Token utilization remains independently measured.

Floret owns bounded recovery, complete ordered image-summary batching, protected
current inputs and replacement validation. A failed/cancelled summary never
installs a partial checkpoint, and completed tools are never replayed. Schema 34
migration belongs exclusively to Floret; Redeven never patches upstream records.

### Timeline
One row between short separators uses a compact surface-owned tooltip without expansion or reflow. Success labels canonical message text estimates explicitly, never as full provider-request input. Localize missing-count, running and cancelled explanations. Wrap original errors without clipping; localize the fallback only when absent.

The tooltip follows the active surface and global theme outside chat. Prefer above, or below near the top boundary. Delay pointer-exit dismissal for hovering/selection. Escape, Tab, blur and outside clicks dismiss it; the visibility owner closes it on process collapse. Retain keyboard/touch access and independent retry.

## Request measurement
Floret calculates pressure from a qualified native prefix plus the remaining frozen-input estimate, or the complete estimate when proof does not match.

Desktop RPC prepares supported provider requests on the credential-owning side and
returns the rendered estimate and fingerprint. Execution, output refits and retries
use the same frozen input. DeepSeek prepares authorized images through Floret's
credential-scoped, expiring upload owner and reuses cached uploads for repeated
preparations. The Desktop bridge does not claim native usage measurement proof
that was not transferred and validated across the RPC boundary. Floret's logical
preparation context releases Desktop handles after settlement or discard, while
single-attempt close preserves replay for as long as that context remains active.
Floret v7.107.4 verifies saved DeepSeek assistant boundaries even inside
Runtime-grouped messages when Retry follows retained reasoning with a new tool
call. Desktop forwards opaque state unchanged; confirmed effects and native
history survive restart and Fork without replaying the tool.

RPC v6 applies one-part request credit, bounded response reassembly and per-request
cancellation. Prepared handles transfer ownership only after the client acknowledges
the result; cancellation before acknowledgment releases them on Desktop. A slow consumer cannot fill another request's queue or close the
shared connection; incompatible older peers fail the version handshake.

The 90% threshold and public output reservation semantics remain upstream.

Unknown gateways, hosted execution, automatic truncation and hidden continuation do not qualify.

Output refits and transport retries preserve the same frozen input; failed or cancelled attempts never supply committed response evidence.

## Manual compaction
Pure compaction ends after install/noop; Goal continuation prepares context and uses existing Engine/current review in the same execution. Floret owns Stop/Retry/restart.

### Explicit manual intent
`POST /_redeven_proxy/api/ai/threads/{id}/context/compact` accepts `storage_generation`, `client_request_id` and optional `continue_goal`. True selects `goal_continuation` only when Floret finds an active canonical Goal during admission.

Failure and noop retain their actionable error or result.

# Boundaries

Floret owns summary, validation, convergence and installation. Never reclassify historical `/compact` output as successful compaction. [Cache counts and latest/cumulative rates](model-request-reuse.md#cache-usage-presentation) use confirmed canonical usage, not another host store.

Floret alone checks attempt identity, commits output, persists and revalidates measurements, selects pressure and executes bounded [compaction and recovery](#usage-and-recovery). [Request reuse](model-request-reuse.md) cannot broaden native coverage proof.

Floret exclusively owns canonical compaction and Goal execution. [Usage and presentation](#usage-and-recovery) maps upstream facts; [qualification](../operations/flower-compaction-qualification.md#compaction) defines isolated runtime and provider checks.

# Evidence

- `redeven:internal/ai/floret_thread_context.go` - Source.
- `redeven:internal/flower_ui/src/runtimeCurrentView.test.ts` - Tests.

- redeven:internal/ai/model_gateway_measurement.go
- redeven:internal/ai/model_gateway_measurement_test.go
- HTTP proof isolation, WebSocket lifetime changes, hidden execution rejection and explicit zero output.

- `redeven:internal/ai/compact_thread_context.go` - Source.
- `redeven:internal/ai/compact_thread_context_test.go` - Tests.
