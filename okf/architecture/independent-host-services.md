---
type: Runtime Contract
title: Independent Host service lifecycle
description: Preserve running applications across management restarts and recover only verified process ownership.
tags: [architecture, managed-services, host, recovery, security]
timestamp: 2026-09-09T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: the application owns its business execution; Redeven owns authorized lifecycle actions, native process identity, launch records, and opening validation.
- Outcome: Desktop or Runtime exit, restart, or upgrade leaves a launched service's PID and launch generation unchanged.
- Invariants: no new binary, resident supervisor, application-specific driver branch, process-output pipe to Runtime, or ownership inferred from PID alone.
- Recovery boundary: absent, mismatched, and uninspectable resources are distinct. Only confirmed absence permits eligible automatic startup; opening failure never stops a running application.

# Contract

## Independent execution
Host launches in its own session and process group. The foreground start contract remains: templates must not double-fork, background the application, or retain a permanent wrapper.

This is not a resident service supervisor or another binary.

## Native identity and recovery
The `host:v3` identity binds service ID, launch nonce, PID, and a digest of native facts:

New identities never use formatted dates, timezone, command text, or `kern.boottime`.

An old process's inherited output descriptors cannot be replaced externally; independent output handling takes effect on its next explicit restart.

## Opening and presentation
Host supplies verified native launch identity and executes only the applied authorized hooks through the common [managed opening contract](managed-web-service-opening.md). The driver stores only launch facts and after-start hook completion, never executable snapshots or a second entrance cache. Preparation follows healthy startup and can be retried without stopping the application.

# Boundaries

Endpoint reachability is checked separately from process identity.

Imported Host templates receive `REDEVEN_TEMPLATE_DIR` pointing to the active original source directory for helper files; [Git source review](managed-service-git-sources.md) prevents replacement during associated service operations and opening hooks.

# Evidence

- `redeven:internal/managedwebservice/custom_host.go` - Session launch, durable gate, identity verification, and explicit Stop.

- `redeven:internal/managedwebservice/process_identity_darwin.go` - Native macOS boot and birth facts.

- `redeven:internal/managedwebservice/process_identity_linux.go` - Native Linux boot, ticks, user, and namespace facts.
