---
type: Architecture Contract
title: Container execution and operation observation
tags: [architecture, containers, operations, reconciliation]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Every container operation binds exact engine, endpoint and resource identity. The service owns admission through execution and read-only reconciliation; UI streams observe it. Cancellation is explicit, terminal uncertainty never replays commands and transfer counters report only measured download facts.

# Contract

## Operation ownership
### Admission and serialization
The operation key contains engine, opaque endpoint ID, resource kind, and canonical identity.

Reusing a request ID with different hashes produces an idempotency conflict instead of a second operation.

### Execution, cancellation, and events
The service owns an operation context from queued state through reconciliation. Cancellation is an explicit API action; closing Activity, Workbench, an inspector, an event stream, or the browser never implies cancellation.

Terminal errors use a small public taxonomy for storage, registry availability, rate limiting, not-found, and access denial; the drawer maps known codes to localized guidance alongside the durable timeline. Unknown codes use a localized generic failure; codes and backend messages remain diagnostic evidence, not visible UI copy. Timeout guidance acknowledges that host work may still be in progress. Desktop service cards direct users to its native application for setup/startup recovery and expose status revalidation. Service history shows state transitions without generic execution stages or a synthetic percentage bar.

### Authoritative terminal observation
After engine execution returns, the service reloads the exact endpoint-bound resource or relevant bounded inventory.

The operation is never replayed, regardless of whether the resource appears present or absent.

### UI observation
Inventory requests and streams are fenced by source runtime, endpoint, resource view, and request generation. A superseded response cannot replace current data.

Mobile and desktop expose the same state and cancellation authority. Service lifecycle feedback stays on its card; history is secondary. Polling terminal transitions refresh authoritative service/runtime facts even when the event stream was lost. The portaled history drawer owns its responsive container and independent scrolling. Desktop uses a history sidebar; narrow drawers place a horizontal history strip above details. Rows use stable operation IDs and pressed selection; polling preserves focus and detail nodes. Details separate identity, live cancellation, duration/current health and timeline. The active final timeline step uses a pending indicator, never a completed check.

## Engine execution
Observe Docker/Podman independently without probing inactive contexts or changing global selection.

### Execution ownership
Every request binds `(engine, endpoint_id, resource kind, canonical identity)`.

Observation failures are returned as errors and must never be converted into an empty project or a successful removal.

### Image pull observation
Docker/Podman pulls retain CLI endpoint selection and credential helpers. On Unix the dedicated pull runner supplies terminal output so Docker emits transfer counters; both output streams are read continuously with bounded lines and terminal controls removed. Ordinary command/log runners keep their existing behavior. Windows retains combined pipe output and reports only counters actually supplied by its CLI. Cancellation terminates the task process group; an executed pull is never replayed as a non-streaming fallback.

Downloaded bytes sum observed compressed download counters even while another layer's size is unknown. Total bytes remain unknown until every noncached layer supplies a total. Cached layers contribute no transfer bytes; extraction counters never replace download counters, and download completion does not imply extraction completion. Repeated terminal redraws for unchanged layers are suppressed. Error classification retains bounded trailing evidence, including containerd's unresolved-reference not-found response.

# Boundaries

- The database is operation evidence, not a mutation queue or replay journal.
- UI inventory and SSE consumers observe service authority; they do not own lifecycle state or reconciliation.
- A runtime restart converts active work to interrupted after read-only observation; it never assumes success or retries the command.
- The full native container ownership contract is defined in [Native container resources](container-resources-capability.md#authority).

Endpoint identifiers remain internal, and current endpoint resolution precedes each operation. Unsupported engine methods fail explicitly. Public DTOs retain the native resource contract's redaction and permission rules.

# Evidence

- `redeven:internal/containerresource/service.go` - Source.
- `redeven:internal/containerengine/cli_client.go` - Source.

- `redeven:internal/containerengine/adapter.go` - Source.
- `redeven:internal/containerengine/runtime_detection_test.go` - Tests.
- `redeven:internal/containerengine/image_pull_stream_unix_test.go` - Terminal output, cancellation, and late failure evidence.
- `redeven:internal/containerengine/cli_client_test.go` - Mixed unknown/cached layers and download/extraction accounting.
