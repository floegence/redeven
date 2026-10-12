---
type: Qualification Record
title: Orange remote desktop Viewer follow-up
description: Record Orange live Viewer, input failures and measured RustDesk comparison boundaries.
tags: [desktop, ssh, deployment, qualification]
timestamp: 2026-10-12T03:20:00Z
---
# Summary

Env App owns permanent desktop service updates and Runtime admission. Orange's
Runtime and service admission were updated through the real product flow, and
the controlling Mac opened a live Viewer. Client presentation qualification is
still failing: earlier candidate measurements show unmatched input responses,
long latency tails and motion freezes. Real local text input also loses
characters in the host GTK/IBus target. RustDesk parity requires three complete
paired rounds at equal delivered visual quality; native capture/encoding FPS
and source checks cannot establish that outcome.

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
The real Env App service update subsequently admits this Runtime image. The
active service is PID `280685`, with immutable deployment identity
`eac4eceadcb23c2ac9b2ab44ed0684385985cbddc1b3f8c83abe59b9234510f4`.
That deployment identity is distinct from the native package recipe digest.
The [SSH deployment contract](../architecture/remote-desktop-ssh-deployment.md)
owns the update and admission boundary.

The isolated local task profile is `/tmp/redeven-orange-viewer-desktop`,
Runtime PID `24771`, bound to `127.0.0.1:24438`; Desktop PID `24567` uses the
committed source above. Remote Runtime state is existing `/home/tang/.redeven`;
remote state isolation was not achieved. The task GTK fixture has a bounded
lifetime and receives only its own window's input.

## RustDesk Comparison Preparation

The operator requires latency and performance at least equal to RustDesk.
The official stable baseline is RustDesk `1.5.0`, source
`fada664df7a294d1d1a9ca3e7cd3637069122f17`. Downloaded ARM64 Linux and macOS
artifacts match their official release SHA-256 digests. The Linux AppImage is
also verified and prepared for a scoped test setup. The operator authorizes a temporary direct-LAN RustDesk session and bounded
native observation of the two test windows. The temporary clients run without
public-broker registration or a permanent service installation.

The comparison must keep the physical output, original pixel dimensions,
refresh rate, client viewport and delivered visual quality equal. Use one
measured Viewer at a time and alternate product order in three paired rounds.
Record route, codec, hardware use, network conditions and all failed or
unmatched samples. Idle response, active scrolling and static desktop work
must be represented; lowering quality does not satisfy performance acceptance.

Primary latency is test input observed on the Mac to its matching scene
sequence visible in client-window pixels, using one client monotonic clock.
Compare P50/P95, unique presented FPS, frame gaps and freezes, and complete host
and client process-tree resource use. Source timecode age requires separate
clock-offset uncertainty. Numeric client/native command-ID equality, CUA call
duration and private native packet arrival are insufficient substitutes.
Client-window observation excludes physical photons.

Orange remains active and unlocked on Ubuntu 22.04.5, Orange Pi 5 Max, with the
performance CPU governor. A new twelve-packet network probe loses one packet;
received RTT ranges from 6.971 to 128.716 ms. These observations require repeated
paired comparison, not attribution of network variation to either product.
The controlling Mac is unlocked, and both real client windows were exercised.

## Current Measurement And Input Failures

The first candidate idle run matches 95 of 100 responses, with P50/P95
168.65/1039.40 ms. Its motion run matches 96 of 100, with P50/P95
155.98/255.37 ms, 25.80 unique presented FPS and 11 freezes above 250 ms.
RustDesk's initial idle run matches all 100 at 204.19/305.98 ms; its repeated
motion run matches all 100 at 120.23/139.27 ms, 40.00 presented FPS and no
freezes above 250 ms. These are preliminary rounds: the repeated RustDesk
motion run lacks a complete simultaneous resource trace, and a Wi-Fi probe
alone cannot assign product latency tails to network conditions.

Performance commit `b4c7e715711c188e2395dea25914e3a2e3bc2092` is published as
immutable native module tag `v0.22.35`; release qualification is still pending.
Its physical shared capture/MPP path measures 53.83 FPS, and 1080p shared upload
plus encoding measures P50/P95 5.31/5.83 ms. Formal Redeven still consumes
`v0.22.34`; neither that native result nor an isolated candidate installation
qualifies the real client.

A real Viewer in Use local input method submits the test string
`Orange 验证：中文 日本語 한국어 😀`; the task GTK document instead contains
`Ovangv ：   ` followed by newline. A later single `A` becomes `v`.
The test target logs Ctrl+V key events whose V-down modifier state sometimes
lacks Control. Independent native tests reproduce failure against Orange's
system GTK 3.24.33/IBus 1.5.26 target. The prepared GTK target and the system
fixture with only its own simple IM context each pass three runs. No host input
method preference is changed; this evidence does not qualify genuine IME.

A separate Viewer regression couples local Ctrl+V/Command+V to host clipboard
synchronization, which DRM does not advertise. The product fix routes explicit
local paste through the existing bounded client text command, discards delayed
reads after mode/authority changes, and reports denied clipboard access without
mutating host synchronization. Browser and Electron qualification pass, including
Unicode, byte limits and mode-change fencing. A real updated Viewer readback
remains required.

# Boundaries

Real Viewer lock, wrong/correct password, successor input and bounded
control-socket recovery remain required for this follow-up. Stop all observation
before credential entry; credentials never enter evidence, command arguments,
environment or diagnostics. The
[native AFBC record](remote-desktop-orange-afbc-results.md) owns the separate
native capture and physical lock/input qualification.
RustDesk parity remains unqualified until both products complete the same
measured workloads and any proven candidate bottlenecks are resolved.

# Evidence

- `scripts/redevplugin_release_contract.mjs` and its tests: linked CLI execution, evidence generation and strict manifest rejection.
- `desktop/src/main/runtimePackageCache.ts`: source package construction and verified package reuse.
- `desktop/src/main/sshRuntime.ts`: staged update, process identity and activation ownership.
- `desktop/src/main/remoteDesktopDeployment.ts`: Env App-authorized native service update and executable admission.
- [RustDesk 1.5.0 official release](https://github.com/rustdesk/rustdesk/releases/tag/1.5.0): baseline source identity, original artifacts and SHA-256 digests.
- [Native v0.22.35 source checks](https://github.com/floegence/floe-native-apps/actions/runs/38197885554): exact published performance commit passes Linux, macOS and Windows source checks.
- [Native v0.22.35 release qualification](https://github.com/floegence/floe-native-apps/actions/runs/38198120459): owning installed-stack lane; an initial ARM64 media download failure requires targeted rerun.
- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js` and `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: explicit local paste, bounded text and delayed-read fencing.
- Native `hostdesktop/login_text_qualification_linux_test.go`: target-document qualification; packaged GTK success does not establish the system GTK/IBus boundary.
