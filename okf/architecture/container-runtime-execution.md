---
type: Architecture Contract
title: Container runtime execution
tags: [architecture, containers, docker, podman]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

containerengine owns Docker/Podman discovery and execution. Each request binds engine, endpoint and canonical resource. Observe engines independently without probing inactive contexts or changing global selection. Failures stay explicit, never empty success or fallback; resource mutations retain their own admission owner.

# Contract

## Execution ownership
Every request binds `(engine, endpoint_id, resource kind, canonical identity)`.

Observation failures are returned as errors and must never be converted into an empty project or a successful removal.

## Image pull observation
Docker/Podman pulls retain CLI endpoint selection and credential helpers. On Unix the dedicated pull runner supplies terminal output so Docker emits transfer counters; both output streams are read continuously with bounded lines and terminal controls removed. Ordinary command/log runners keep their existing behavior. Windows retains combined pipe output and reports only counters actually supplied by its CLI. Cancellation terminates the task process group; an executed pull is never replayed as a non-streaming fallback.

Downloaded bytes sum observed compressed download counters even while another layer's size is unknown. Total bytes remain unknown until every noncached layer supplies a total. Cached layers contribute no transfer bytes; extraction counters never replace download counters, and download completion does not imply extraction completion. Repeated terminal redraws for unchanged layers are suppressed. Error classification retains bounded trailing evidence, including containerd's unresolved-reference not-found response.

# Boundaries

Endpoint identifiers remain internal, and current endpoint resolution precedes each operation. Unsupported engine methods fail explicitly. Public DTOs retain the native resource contract's redaction and permission rules.

# Evidence

- `redeven:internal/containerengine/adapter.go` - Source.
- `redeven:internal/containerengine/runtime_detection_test.go` - Tests.
- `redeven:internal/containerengine/image_pull_stream_unix_test.go` - Terminal output, cancellation, and late failure evidence.
- `redeven:internal/containerengine/cli_client_test.go` - Mixed unknown/cached layers and download/extraction accounting.
