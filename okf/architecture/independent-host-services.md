---
type: Runtime Contract
title: Independent Host service lifecycle
tags: [architecture, managed-services, host, recovery, security]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Applications own execution; Redeven owns authorized lifecycle, native identity, launch records and opening validation. Desktop/Runtime restart or upgrade preserves launched PID/generation. No supervisor, app-specific driver, output pipe or PID-only authority. Distinguish absence/mismatch/uninspectability; only proven absence permits startup, and opening failure never stops the app.

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

- `redeven:internal/managedwebservice/process_identity_linux.go` - Native Linux boot, ticks, user, and namespace facts.
