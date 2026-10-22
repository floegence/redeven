---
type: Qualification Record
title: Orange remote desktop Viewer follow-up
description: Record published native deployment, real Viewer recovery and the measured RustDesk acceptance boundary.
tags: [desktop, ssh, deployment, qualification]
timestamp: 2026-10-12T10:32:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Orange runs published native `v0.22.37` through Env App update and executable
admission; all thirteen release qualification jobs pass. Real Viewer checks pass
Unicode paste, physical lock, wrong-password rejection, unlock, successor input
and scoped media recovery. Mac local Pinyin is deferred; host Pinyin remains
unvalidated. Two paired rounds improve matched latency tails and motion FPS,
but missing idle responses and failed SSH carrier recovery prevent RustDesk
parity. A third RustDesk half has severe tails and disconnects. Comparison moves
to udesk26 after measured Orange LAN loss; complete quality and resource
evidence is still required.

# Contract

## Current Product Deployment
The task Desktop uses state `/tmp/redeven-orange-viewer-desktop` and a bundle built from Redeven `bb6683b5ce18`, consuming published native `v0.22.37` with `GOWORK=off`. Only bounded task fixtures receive qualification input.

The [SSH deployment owner](../architecture/remote-desktop-ssh-deployment.md) defines update and admission; deployment identity differs from recipe identity.

## Release And Regression Evidence
Redeven `b7d994aff911` fixes Node 26 linked-entrypoint identity after Desktop exit 71 exposed skipped release verification; all 31 affected checks pass.

Redeven setup nevertheless fails before installation because the Go module omits nested MPP assets; the old service remains usable.

Test tabs and the isolated HTTP server close afterward.

## Real Viewer Acceptance
Explicit local paste previously depended on host clipboard synchronization, which DRM does not advertise. The product adapter now uses existing bounded client text, fences delayed reads after mode/authority changes and reports denied clipboard access.

Credentials never enter evidence, command arguments, environment or diagnostics.

## RustDesk Comparison Status
The [physical desktop comparison](remote-desktop-rustdesk-comparison-results.md) owns its method, measurements and unresolved acceptance boundaries. Orange results remain evidence for Orange only; no hardware-wide parity claim is supported.

# Boundaries

These observations apply only to the recorded hardware, published candidate and measured paths. The acceptance results and unresolved cases above remain authoritative.

# Evidence

- `scripts/redevplugin_release_contract.mjs` and tests: linked CLI execution and release verification.

- `desktop/src/main/sshRuntime.ts` and `remoteDesktopDeployment.ts`: normal update and Env App admission.

- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js` and `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: lock authority, recovery and bounded paste.
