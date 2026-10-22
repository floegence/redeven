---
type: Runtime Contract
title: Managed Service operation progress
description: Persist and stream bounded, redacted lifecycle command output while preserving stable, user-controlled progress presentation.
tags: [architecture, managed-services, operations, observability, security, ui]
timestamp: 2026-09-09T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: a Manager-owned Reporter publishes each active operation; the Registry owns durable history.
- Outcome: users can inspect bounded lifecycle output in a focused drawer view and keep a brief completion visible while list and stream refreshes preserve the expanded operation.
- Invariants: safe command templates, pre-persistence redaction, one operation ID for disclosure, readable terminal feedback, and no Runtime identity derived from output.
- Failure boundary: persistence, streaming, capture, and validation failures never expose raw output, secrets, credentials, sensitive URL queries, private paths, or control characters.

# Contract

## Reporter and persisted detail
`ManagedOperationProgressDetail` schema v2 is the sole progress document. Duplicate proposed command IDs receive deterministic suffixes so output cannot become ambiguous.

Failed uninstall retains current records and output; the [management review](service-management-recovery.md) presents completed and pending resources before a new confirmed continuation.

## Service-row interaction
The owning page stores explicit expanded or collapsed state by `operation_id`; row component identity and service-object identity are not state owners. A rejected submission retains its safe failure in the same renderer disclosure; it creates no durable backend operation and does not change the observed service state.

Reduced-motion preference removes the animation without shortening the readable hold.

# Boundaries

Operation output is observability data, not a terminal, shell, downloadable transcript, or raw debug channel. Renderer cannot request an unredacted variant. Template hooks parse it, and the generic URL validator keeps their result outside this progress document.

# Evidence

- `redeven:internal/managedwebservice/operation_progress.go` - Owns concurrent mutation, throttled persistence, limits, sequencing, and redaction.

- `redeven:internal/managedwebservice/npm_host.go` - Streams real npm install and rebuild output through the Reporter.

- `redeven:internal/managedwebservice/custom_host.go` - Streams Host lifecycle output through one collector and closes commands with their actual result.
