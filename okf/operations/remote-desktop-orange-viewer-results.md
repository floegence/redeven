---
type: Qualification Record
title: Orange remote desktop Viewer follow-up
description: Record Orange live Viewer, input failures and measured RustDesk comparison boundaries.
tags: [desktop, ssh, deployment, qualification]
timestamp: 2026-10-12T04:18:00Z
---
# Summary

Env App owns permanent desktop service updates and Runtime admission. Orange's
earlier Runtime and service admission were updated through the real product
flow, and the controlling Mac opened a live Viewer. The v0.22.35 Runtime upgrade
succeeds, but its service deployment stops at module extraction because that
published module omits nested MPP assets. Published native `v0.22.36` restores
service-kit extraction and passes real system GTK text and cancellation checks;
its release qualification and real Viewer update remain pending. Earlier client
measurements still show unmatched responses, latency tails and motion freezes. RustDesk parity requires
three complete paired rounds at equal delivered visual quality; native capture/encoding FPS
and source checks cannot establish that outcome.

# Contract

## Product Update And Identity

The earlier Desktop build failed with exit 71: the release-contract CLI compared
its canonical module URL with a symlinked checkout argument, skipped execution
and returned success without verification evidence. Commit `b7d994aff911` uses
Node 26 entrypoint identity; all 31 linked-path and manifest tests pass. The
[release gate](../release/redevplugin-release-gates.md) owns verification rules.
Intermittent SSH banner failures and `write EPIPE` preserved the installed
Runtime. A later normal **Actions → Update** and Env App service update succeeded.

That earlier Runtime was `b7d994aff911`, PID `223454`, SHA-256
`7840330016371c66dd392a24fce3cec9781f31fb3de0f48b410c8f0b34399dd2`.
Service PID `280685` admits that image, with deployment identity
`eac4eceadcb23c2ac9b2ab44ed0684385985cbddc1b3f8c83abe59b9234510f4`.
Deployment identity is distinct from native recipe identity; the
[SSH deployment contract](../architecture/remote-desktop-ssh-deployment.md)
owns service update and admission.

The latest normal Desktop update installs Runtime `f5428b6eb834`, built
`2026-10-12T03:39:16Z`, SHA-256
`869ed2fe36d60a5b4aac13bf68ed917d680f5a1d8a84a665aeaaa79d5f9fc7de`,
PID `381199`. Desktop PID `53392` uses the matching published-dependency bundle.
Env App service setup then fails before privilege or installation:
`desktop-service-kit` fails in both the bundle and its focused CLI test because
Go module packaging omits nested MPP headers. The old service remains unchanged
and cannot admit the new Runtime. No production files are replaced manually.
Physical Wayland session `2` remains active and unlocked.

The task profile is `/tmp/redeven-orange-viewer-desktop`; local Runtime PID
`24771` uses `127.0.0.1:24438`. Remote state is existing `/home/tang/.redeven`,
so remote state isolation was not achieved. Only bounded task fixtures receive
qualification input.

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
immutable native module tag `v0.22.35`. Release qualification passes after a
targeted rerun of the ARM64 original-media download failure.
Its physical shared capture/MPP path measures 53.83 FPS, and 1080p shared upload
plus encoding measures P50/P95 5.31/5.83 ms. Redeven `f5428b6eb834` consumes
published `v0.22.35`; neither native throughput nor isolated installation
qualifies the real client.

The earlier real Viewer in Use local input method submits the test string
`Orange 验证：中文 日本語 한국어 😀`; the task GTK document instead contains
`Ovangv ：   ` followed by newline. A later single `A` becomes `v`.
The test target logs Ctrl+V key events whose V-down modifier state sometimes
lacks Control. Independent native tests reproduce failure against Orange's
system GTK 3.24.33/IBus 1.5.26 target. The prepared GTK target and the system
fixture with only its own simple IM context each pass three runs. No host input
method preference is changed; this evidence does not qualify genuine IME.

Native commit `064b068c8fa596186538c4df5432d133125afda9`, published as immutable
module tag `v0.22.36`, moves the
pinned API closure outside `vendor`, preserves header/license bytes and deployed
names, and checks every embedded desktop asset against Go module archive rules.
An actual module archive round trip passes service-kit extraction; source binary
permission checks belong to the checkout because Go archives remove executable
bits. Both architecture artifacts/provenance and the source gate pass.

The same native commit holds Control until selection completion/error and revokes
input before waiting for the clipboard child. Transfer identity fences retired
completion from successor input. The unchanged system-default GTK target fails
three rounds before the fix and passes three complete rounds afterward, including
Unicode, emoji, readonly-target modifier release and cancellation followed by
acknowledged successor input. This uses the actual user HOME and session bus; it
does not change host input-method preferences or establish genuine IME behavior.
The operator authorizes only this upstream commit and version for publication.
The public Go proxy and checksum database bind `v0.22.36` to that commit with
module sum `h1:RjJuUSImyjeUy2R+LHKSYrxqa9ic+sSucfL9mMNJEQ8=`. Both the
public module's focused packing/service-kit checks and Redeven's service-kit CLI
test pass with `GOWORK=off`. Redeven consumes this published version; activation
on Orange waits for the owning release gate. The native fix still runs only in
the task-owned qualification service. Main source checks pass; the first release
attempt has AMD64 media and private-desktop download failures before activation.
The ARM64 native application lane also times out on the GTK4 4.0/glibc 2.31
editing receipt: 41 commits complete, while commit 42's marker is delivered but
not taken. Its trace is retained for targeted qualification; this release does
not modify the private-desktop input modules or that fixture. The ARM64 media
and private-desktop lanes pass. This unresolved failure still blocks the release
gate and production activation.

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
- [Native v0.22.35 release qualification](https://github.com/floegence/floe-native-apps/actions/runs/38198120459): owning installed-stack lane; all jobs pass in attempt 2 after a targeted ARM64 original-media download rerun. This lane used the checkout and did not establish module archive completeness.
- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js` and `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: explicit local paste, bounded text and delayed-read fencing.
- Native `hostdesktop/login_text_qualification_linux_test.go`: target-document qualification; packaged GTK success does not establish the system GTK/IBus boundary.
