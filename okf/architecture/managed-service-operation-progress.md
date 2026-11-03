---
type: Runtime Contract
title: Managed Service operation progress
tags: [architecture, managed-services, operations, observability, security, ui]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Manager Reporter owns live output; Registry owns history. One operation ID retains disclosure/completion through refresh. Redact command templates before storage; output grants no identity. Capture/storage/transport failures must not expose secrets, queries, private paths or control bytes.

# Contract

## Reporter and persisted detail
`ManagedOperationProgressDetail` schema v2 is the sole progress document. Duplicate proposed command IDs receive deterministic suffixes so output cannot become ambiguous.

Failed uninstall retains current records and output; the [management review](service-management-recovery.md) presents completed and pending resources before a new confirmed continuation.

## Service-row interaction
The owning page stores explicit expanded or collapsed state by `operation_id`; row component identity and service-object identity are not state owners. A rejected submission retains its safe failure in the same renderer disclosure; it creates no durable backend operation and does not change the observed service state.

Rows retain a compact operation status; explicit status activation opens detail without automatic row growth. Failed/interrupted operations remain visibly labelled. Service notices remain visible across operation arrival, settlement and dismissal; only operation details follow disclosure. Reduced-motion preference removes the animation without shortening the readable hold.

# Boundaries

Operation output is observability data, not a terminal, shell, downloadable transcript, or raw debug channel. Renderer cannot request an unredacted variant. Template hooks parse it, and the generic URL validator keeps their result outside this progress document.

# Evidence

- `redeven:internal/managedwebservice/operation_progress.go` - Source.
- `redeven:internal/managedwebservice/custom_host.go` - Source.
