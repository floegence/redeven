---
type: Architecture Contract
title: Container execution and operation observation
tags: [architecture, containers, operations, reconciliation]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Container operations bind exact engine/endpoint/resource. Public terminal taxonomy distinguishes storage, registry availability, rate limit, missing and denied; UI maps known codes to localized guidance with durable timeline.

# Contract

## Operation ownership
### Admission and serialization
Key by engine, opaque endpoint ID, kind and canonical identity. Reused request ID with changed hashes conflicts, never creates another operation.

### Exact recovery
Read exact operation ID or read-only by-request/<request_id>, independent of recent-list limits. Absence remains uncertain while admission may be in flight; never replay. Container-Operation-Admission: rejected is valid only before operation storage, not a storage-boundary failure.

### Execution, cancellation, and events
Service context spans queue through reconciliation. Only explicit API cancels; closing UI/streams/browser does not. Unknown codes use localized generic failure; raw code/message remain diagnostics. Timeout acknowledges possibly running host work. Desktop setup/startup directs to native app plus status revalidation. Service history uses actual transitions, no generic stages/percentage.

### Authoritative terminal observation
After execution, reload exact endpoint resource/bounded inventory; presence/absence never authorizes replay.

### UI observation
Shell owns pending admissions, concurrent streams and settlement invalidation; Settings/inventory own presentation only. Ambiguous submission retains exact request and blocks duplicates while background reads reconcile. Disposal never cancels admitted work; same-owner reconnect retains history, authentication/environment change retires observers. Fence requests/events by runtime/endpoint/view/generation; stale inventory cannot regress operations. Mobile/desktop share state/cancel authority. Card owns live lifecycle; history is secondary. Terminal polls refresh service/Runtime even after stream loss. Portaled drawer owns responsive container/scroll: sidebar on desktop, horizontal history above narrow details. Stable IDs/pressed rows preserve focus/detail DOM. Separate identity, cancel, duration/current health and timeline; active final step stays pending.

## Engine execution
Observe Docker/Podman independently; never probe inactive contexts or change global selection.

### Execution ownership
Every operation revalidates exact endpoint/resource; observation error is never empty project or successful removal.

### Image pull observation
Preserve CLI endpoint/credential helpers. Unix dedicated pull supplies terminal output and continuously reads both streams with bounded lines/control stripping; ordinary runners unchanged. Windows reports only actual combined-pipe counters. Cancellation stops owned process group; never replay executed pull through nonstreaming fallback.

Sum observed compressed-download counters even with unknown layers. Total stays unknown until every noncached layer reports it; cached contributes zero, extraction never replaces download and completed download is not completed extraction. Suppress unchanged redraws. Preserve bounded trailing error evidence, including containerd unresolved-reference missing errors.

# Boundaries

DB is evidence, not queue/replay journal. UI observes lifecycle; restart read-only reconciliation marks active work interrupted, never success/retry. [Native authority](container-resources-capability.md#authority) owns redaction/permissions. Endpoints stay internal and resolve freshly before operations; unsupported methods fail explicitly.

# Evidence

internal/containerresource/service.go owns service. internal/containerengine/runtime_detection_test.go, image_pull_stream_unix_test.go and cli_client_test.go cover detection, terminal/cancel/late failures and mixed unknown/cached/extraction accounting.
