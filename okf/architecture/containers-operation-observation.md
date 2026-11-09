---
type: Architecture Contract
title: Container execution and operation observation
tags: [architecture, containers, operations, reconciliation]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Operations bind exact engine, endpoint and resource identity. Known storage, registry, rate-limit, not-found and permission codes receive localized guidance beside the durable timeline.

# Contract

## Operation ownership
### Admission and serialization
The key binds engine, opaque endpoint ID, resource kind and canonical identity; a reused request ID with different hashes yields an idempotency conflict.

### Exact recovery
Settings reads a known operation by ID, or uses the read-only `by-request/<request_id>` endpoint when creation returned no operation ID. Neither depends on the bounded recent-operation list. Absence remains uncertain because admission may still be in flight; observation never replays a mutation. `Container-Operation-Admission: rejected` is emitted only before entering operation storage, never for a storage-boundary failure.

### Execution, cancellation, and events
The service owns an operation context from queued state through reconciliation. Cancellation is an explicit API action; closing Activity, Workbench, an inspector, an event stream, or the browser never implies cancellation.

Unknown codes receive generic localized failure copy; raw diagnostics stay separate. Timeout does not prove execution stopped. Desktop recovery directs users to its native application and status revalidation. History shows actual transitions, not synthetic stages/percentages.

### Authoritative terminal observation
After execution, reload the exact endpoint-bound resource or bounded inventory. Presence or absence never authorizes replay.

### UI observation
Shell owns pending admissions, concurrent operation streams and settlement invalidation. Settings and inventory views own only presentation. Ambiguous submissions retain their exact request identity and block duplicate work while background reads reconcile admission. View disposal cannot cancel accepted work. Same-owner reconnect retains history; authentication/environment changes retire observers. Inventory reads remain runtime/endpoint/view-generation fenced; stale snapshots cannot regress operation state.

Mobile/desktop share state and cancellation authority. Lifecycle feedback stays on service cards; terminal polling refreshes facts after stream loss. The portaled drawer scrolls independently, with a desktop sidebar or narrow horizontal history strip. Stable operation IDs and pressed selection preserve focus/detail nodes. Details separate identity, cancellation, duration/health and timeline; active steps show pending, never completion.

## Engine execution
Observe Docker/Podman independently without probing inactive contexts or changing global selection.

### Execution ownership
Observation failures return errors, never an empty project or successful removal.

### Image pull observation
Pulls preserve CLI endpoint/credential helpers. Unix's dedicated terminal runner captures both streams with bounded lines and stripped controls; other runners stay unchanged. Windows uses combined pipes and only actual CLI counters. Cancel terminates the task process group; never replay a pull as a non-streaming fallback.

Downloaded bytes sum observed compressed counters; totals remain unknown until all noncached layers report sizes. Cached layers add no transfer bytes. Extraction is separate and may continue after download. Suppress unchanged redraws; retain bounded trailing error evidence, including containerd unresolved-reference not-found.

# Boundaries

- The database is operation evidence, not a mutation queue or replay journal.
- UI inventory and SSE consumers observe service authority; they do not own lifecycle state or reconciliation.
- A runtime restart converts active work to interrupted after read-only observation; it never assumes success or retries the command.
- The full native container ownership contract is defined in [Native container resources](container-resources-capability.md#authority).

Endpoint identifiers remain internal, and current endpoint resolution precedes each operation. Unsupported engine methods fail explicitly. Public DTOs retain the native resource contract's redaction and permission rules.

# Evidence

- `redeven:internal/containerresource/service.go` - Source.

- `redeven:internal/containerengine/runtime_detection_test.go` - Tests.
- `redeven:internal/containerengine/image_pull_stream_unix_test.go` - Terminal output, cancellation, and late failure evidence.
- `redeven:internal/containerengine/cli_client_test.go` - Mixed unknown/cached layers and download/extraction accounting.
