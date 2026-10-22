---
type: Security Contract
title: Administrator-authorized remote desktop deployment over SSH
description: Install and manage the Linux physical-desktop service from Env App without target-side graphical consent.
tags: [desktop, ssh, authorization, runtime, security]
timestamp: 2026-10-16T17:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop owns SSH authorization and the lifetime of one UI operation. Published
Floe Native Apps owns the only privileged preparation transaction. Runtime owns
product authorization, read-only service authentication and audit. Every SSH
connection uses **ensure**, including active services whose policy may pin an
older Runtime. It authenticates the actual running Runtime before opening the
physical desktop. Unknown ownership and unsupported records fail unchanged.
Cancellation reports observed rollback; transport loss never proves recovery.
A verified manager completion remains authoritative when commit wins a cancel
race; cancellation still suppresses automatic viewer opening.

# Contract

## Target and administrator authority
Only the main frame and owning root document of an SSH environment may use the typed deployment IPC. The environment must grant read, write and execute.

Sensitive administrator streams retain no stdout/stderr diagnostics.

## One preparation owner
The published manager accepts ensure, stop and uninstall. Supported records migrate; unknown ownership, future versions and unverifiable records remain unchanged.

Service readiness, Runtime admission and capture readiness remain distinct: absent scanout cannot undo valid policy.

## Existing attachments and recovery
A kernel-authenticated root manager holds the service maintenance lease. Unknown counts on old services require confirmation.

Temporary staging cleanup is separately bounded.

## Product interaction and physical limits
The [launcher](remote-desktop-launcher.md) derives progress and actions from one operation state. Operation and challenge IDs reject stale responses.

Input release, takeover confirmation, viewer origin/path admission and local Portal/macOS flows retain their owning contracts.

# Boundaries

## Validation evidence
Focused deployment, transport, launcher, API and locale tests consume published Floe Native Apps v0.23.3 after release and Go proxy/checksum verification.

Active/stopped version-2 installations with stale fingerprints migrated to version 3 after actual Runtime admission.

Test processes/SSH authorization were removed; no service retained the test image.

# Evidence

- desktop/src/main/remoteDesktopDeployment.ts: credential challenge, published manager protocol, proof and cleanup.

- desktop/src/main/remoteDesktopDeployment.test.ts: separate password identities, interruption consent, proof rejection and cancellation.

- desktop/src/main/sshTransportManager.ts: explicit PTY and sensitive stream options.
