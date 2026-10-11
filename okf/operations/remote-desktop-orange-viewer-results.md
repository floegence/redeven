---
type: Qualification Record
title: Orange remote desktop Viewer follow-up
description: Verify Orange Runtime update recovery and distinguish it from pending Env App service deployment and real Viewer acceptance.
tags: [desktop, ssh, deployment, qualification]
timestamp: 2026-10-11T15:54:39Z
---
# Summary

Env App owns permanent desktop service updates and Runtime admission. The
recovered-connection follow-up verifies a successful Orange Runtime update
after repairing linked-path package verification. Its existing native service
retains the older admission; Runtime replacement alone does not qualify the
Viewer. The controlling Mac must be unlocked to continue Env App service
management and real Viewer acceptance. Intermittent SSH failures do not
establish EPIPE's precise cause.

# Contract

## Package Preparation And Product Update

The operator reports Wi-Fi loss and restored connectivity after the
[earlier device run](remote-desktop-device-viewer-results.md). Initial SSH
readback succeeds with Runtime `8c4f56144a2e`. Two real Desktop package builds
fail locally with exit 71 because the release-verification file is absent.
The contract CLI compares its canonical module URL with the symlinked checkout
argument, skips execution and returns success. A deterministic linked-path
test reproduces the missing file.

Commit `b7d994aff911` uses Node 26's entrypoint identity. Linked CLI execution
writes requested evidence and rejects invalid manifests; all 31 staging
contract tests pass. The corrected real Desktop build generates verification
evidence and the complete ARM64 package from published dependencies. The
[release gate](../release/redevplugin-release-gates.md) owns verification rules.

SSH remains intermittent: a control connection succeeds in 3047.2 ms; other
attempts time out at connection or banner exchange, and an update reports
`write EPIPE`. The installed Runtime remains unchanged after that failure.
A later normal card **Actions → Update** reuses the verified package and
successfully replaces the Runtime. No target component is manually replaced.

## Readback And Runtime Identity

Readback confirms `v0.0.0-dev (b7d994aff911)`, built
`2026-10-11T15:39:00Z`, SHA-256
`7840330016371c66dd392a24fce3cec9781f31fb3de0f48b410c8f0b34399dd2`.
Running PID `223454` has that same executable digest. Physical session `2`
remains active on Wayland with `LockedHint=no`.
The root service remains active, PID `9439`, with its previous Runtime admission.
The [SSH deployment contract](../architecture/remote-desktop-ssh-deployment.md)
requires Env App management to admit the replacement executable.

The isolated local task profile is `/tmp/redeven-orange-viewer-desktop`,
Runtime PID `67877`, bound to `127.0.0.1:24438`; Desktop PID `67801` uses the
committed source above. Remote Runtime state is existing `/home/tang/.redeven`;
remote state isolation was not achieved. The task GTK fixture has a bounded
lifetime and receives only its own window's input.

# Boundaries

The controlling Mac locks before Env App service management can continue.
Manual Mac unlock, administrator-authorized service update, exact admission
readback and real Orange Viewer picture/input/lock/recovery evidence remain
required. This record does not claim successful Viewer connection, real IME
composition, matched cursor feedback, end-to-end latency or competitor parity.
The [native AFBC record](remote-desktop-orange-afbc-results.md) owns the separate
native capture and physical lock/input qualification.

# Evidence

- `scripts/redevplugin_release_contract.mjs` and its tests: linked CLI execution, evidence generation and strict manifest rejection.
- `desktop/src/main/runtimePackageCache.ts`: source package construction and verified package reuse.
- `desktop/src/main/sshRuntime.ts`: staged update, process identity and activation ownership.
- `desktop/src/main/remoteDesktopDeployment.ts`: Env App-authorized native service update and executable admission.
