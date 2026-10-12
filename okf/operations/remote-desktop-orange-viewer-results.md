---
type: Qualification Record
title: Orange remote desktop Viewer follow-up
description: Record published native deployment, real Viewer recovery and the measured RustDesk acceptance boundary.
tags: [desktop, ssh, deployment, qualification]
timestamp: 2026-10-12T10:32:00Z
---
# Summary

Env App owns permanent desktop updates and executable admission. Orange now
runs published native `v0.22.37` through that product flow; all thirteen owning
release qualification jobs pass. Real Viewer local paste, mixed Unicode,
physical lock, wrong-password rejection, correct unlock and successor input
pass. A scoped native media connection failure recovers automatically and
accepts successor text. The operator explicitly defers Mac local Pinyin;
host Pinyin also remains unvalidated. Two current paired rounds show lower matched latency tails and higher delivered
motion FPS, but seven first-round idle responses are missing and SSH carrier
recovery fails. A third RustDesk half records severe tails and disconnects.
The operator moves the comparison to udesk26 after measured Orange LAN loss.
RustDesk parity remains unqualified until complete paired evidence proves equal
or better delivered performance at comparable quality and resource cost.

# Contract

## Current Product Deployment

The task Desktop uses state `/tmp/redeven-orange-viewer-desktop` and a bundle
built from Redeven `bb6683b5ce18`, consuming published native `v0.22.37` with
`GOWORK=off`. Normal **Actions → Update** installs that Runtime on Orange at
`/home/tang/.redeven/runtime/managed/bin/redeven`, SHA-256
`256000b266aab552a24a1f8b4f8748d4086def2c5bb32a6add5a5d2ab6b11ce9`.
Existing remote state `/home/tang/.redeven` is preserved; remote state isolation
is not claimed. Only bounded task fixtures receive qualification input.

Env App **Remote desktop → Set up → Authorize and continue** deploys identity
`e753227f5651d1b43a1bc82601de8a47baff284d435976536d4d00e156ac2a94`
and admits that Runtime digest. Readback hashes are
`3c735511bce9e2f4196518a0dd5d78c72c62fe4d1ab260134b70474461335ae7`
for the service, `1e541f185e95ac9e42c67f8c55b0fef5a6785779db1f2cf32c9447fe492dd42a`
for the worker and `399d8c540d590d41641d57ce8f7ee0bed1cc206e2e927bf434a0891f28a6ab9f`
for media. Physical GNOME Wayland session `2` supplies 1920 × 1080 output.
MPP journal readback confirms H.264 at 12 Mbps and 60 FPS; configuration does
not establish delivered client FPS. The [SSH deployment owner](../architecture/remote-desktop-ssh-deployment.md)
defines update and admission; deployment identity differs from recipe identity.

## Release And Regression Evidence

Redeven `b7d994aff911` fixes Node 26 linked-entrypoint identity after Desktop
exit 71 exposed skipped release verification; all 31 affected checks pass.
The [release gate](../release/redevplugin-release-gates.md) owns that boundary.
SSH banner failures and `write EPIPE` preserve the installed Runtime.

Native `b4c7e715711c`, immutable `v0.22.35`, passes checkout qualification.
Physical shared capture/MPP measures 53.83 FPS and upload/encoding P50/P95
5.31/5.83 ms. Redeven setup nevertheless fails before installation because the
Go module omits nested MPP assets; the old service remains usable.

Native `064b068c8fa5`, immutable `v0.22.36`, moves that closure outside `vendor`
and passes public-module service-kit extraction. Its paste modifier fix fails
three real system GTK 3.24.33/IBus 1.5.26 rounds before the change and passes
three afterward: Unicode, emoji, readonly-target release and cancellation with
successor input. Prepared GTK/simple IM fixtures had hidden the problem.
These checks do not establish genuine IME composition. The release gate fails
because `libseccomp-2.6.0-r1.apk` is retired on both architectures; no GitHub
Release is created or immutable tag rewritten.

Authorized `10f2deb5fb6157aa21199e4d972c9d3d1ed10858`, immutable `v0.22.37`,
pins publisher-signed libseccomp 2.6.1-r0 and preserves installed r6 identities.
All 198 AMD64 and 199 ARM64 archives pass hash/size and publisher-signature
checks. A disposable native ARM64 Alpine fixture passes production installation,
pixels, Unicode, reconnection and activation as existing unprivileged `nobody`.
Numeric-UID bus and AMD64 emulation failures remain recorded.

All thirteen owning qualification jobs pass, including both native architectures,
private desktop, media, security and provenance. Release publication at
`2026-10-12T05:45:51Z` binds the reviewed main tip to that tag; public proxy and
checksum evidence bind module sum `h1:V88v8+sHgrMkyMzlVTNnL9VhCvXanupA2EpXoRiRWGo=`.
Redeven's dependency, service-kit and affected Viewer checks pass with `GOWORK=off`.
Subsequent upstream security commit `4b38b897c10b` is unreleased and is outside
this deployed candidate; later main changes do not alter the immutable tag.

That security change confines media archive extraction through `os.Root`, fixes
the token-permission fixture and incorporates Dependabot PRs 3/4/5 with their
authorship preserved. At verification, open PRs, Dependabot, CodeQL, secret
scanning and repository advisories are zero without dismissing findings. Source,
vulnerability and CodeQL checks pass. A complete Safari smoke on the reviewed
commit passes DOMPurify 3.4.16 sanitization, KaTeX 0.18.2 math and untrusted-link
rejection, and Mermaid mathematics rendered as SVG. Test tabs and the isolated
HTTP server close afterward.

## Real Viewer Acceptance

Explicit local paste previously depended on host clipboard synchronization,
which DRM does not advertise. The product adapter now uses existing bounded
client text, fences delayed reads after mode/authority changes and reports denied
clipboard access. Browser/Electron checks cover Unicode, limits and mode fencing.

The updated real Viewer in **Use local input method** passes full-buffer GTK
assertions for `abC中文😀$` and `Orange 验证：中文 日本語 한국어 😀` through paste.
Synthetic `typeText` does not deliver the same mixed string. Automation does not
trigger genuine Mac Pinyin even in System Settings; the operator defers its
manual test. The host Pinyin fixture expires without a result. Both IME outcomes
remain unvalidated; paste is not composition evidence.

Physical GNOME lock sets `LockedHint=yes`. Viewer disables ordinary input,
clipboard and shortcuts and offers **Start unlocking**. One physical wrong
password submission reports failure and retains the lock. Authorized correct
input is interrupted by transport failure; Runtime records local-agent stream
`operation_failed`, and a separate SSH probe has a banner timeout. A new Viewer
opened through Env App while locked then accepts the authorized physical
credential. `LockedHint=no` and ordinary controls return; local paste plus Enter
passes successor `A`. Interrupted attempts remain failures.

A bounded fault verifies the sole active task native media worker by parent,
command and start time, then signals that exact process through pidfd. Viewer
automatically restores capture/control; a fresh GTK successor passes local paste
plus Enter. The root service and unrelated processes stay running. This proves
native media socket recovery, not recovery for every transport failure. All
sampling and fixtures stop before credential entry. Credentials never enter
evidence, command arguments, environment or diagnostics.

## RustDesk Comparison Status

The [physical desktop comparison](remote-desktop-rustdesk-comparison-results.md)
owns its method, measurements and unresolved acceptance boundaries. Orange has
two current paired rounds and a third RustDesk half. Matched responses improve,
but missing responses, failed SSH carrier recovery and incomplete resource/quality
evidence prevent parity. After independent LAN loss and SSH timeouts, the operator
requests udesk26 for the remaining comparison. Orange results
remain evidence for Orange only; no hardware-wide parity claim is supported.

# Evidence

- `scripts/redevplugin_release_contract.mjs` and tests: linked CLI execution and release verification.
- `desktop/src/main/sshRuntime.ts` and `remoteDesktopDeployment.ts`: normal update and Env App admission.
- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js` and `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: lock authority, recovery and bounded paste.
- Native `hostdesktop/login_text_qualification_linux_test.go`: actual GTK/IBus document and cancellation checks.
- [RustDesk official release](https://github.com/rustdesk/rustdesk/releases/tag/1.5.0): baseline source and artifact digests.
- [Native v0.22.35 source checks](https://github.com/floegence/floe-native-apps/actions/runs/38197885554) and [qualification](https://github.com/floegence/floe-native-apps/actions/runs/38198120459): earlier capture and checkout qualification boundary.
- [Native v0.22.37 source checks](https://github.com/floegence/floe-native-apps/actions/runs/38207557472), [qualification](https://github.com/floegence/floe-native-apps/actions/runs/38207784817) and [release](https://github.com/floegence/floe-native-apps/releases/tag/v0.22.37): current published dependency and thirteen successful owning jobs.
- [Native AFBC record](remote-desktop-orange-afbc-results.md): separate native physical capture and lock/input qualification.
