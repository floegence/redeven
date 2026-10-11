---
type: Qualification Record
title: Physical-device remote desktop Viewer qualification
description: Assess deployed udesk26 Viewer behavior and bounded recovery timing while preserving IME, cursor and comparison limits.
tags: [desktop, input, deployment, latency, qualification]
timestamp: 2026-10-11T15:54:39Z
---
# Summary

Env App owns permanent SSH desktop deployment; the privileged native service
owns physical-seat input and lock authority. This run consumes native
`v0.22.34` and qualifies real udesk26 picture, mouse, keyboard, assisted Unicode
commit, physical unlock, window switching, disconnect and Electron fullscreen.
Ordinary input stays disabled while locked or disconnected. Ten injected
control-channel interruptions recover to a new Viewer paint confirmation.
The [Orange follow-up](remote-desktop-orange-viewer-results.md) owns recovered
connection and Runtime update evidence; its Env App service update and Viewer
acceptance remain pending. Real IME composition, matching cursor feedback,
command RTT and RustDesk/NoMachine parity remain unqualified.

# Contract

## Deployment And Host Identity

On 2026-10-11 the task Desktop used card **Actions → Update** for udesk26, then
the real Env App administrator-authorized service deployment. The panel reached
**Connect to desktop**, and the Viewer opened at `/_redeven_desktop/` through
the production SSH placement bridge. No component was manually replaced.

The installed Runtime is `v0.0.0-dev (03bedf6864c9)`, built at
`2026-10-11T12:47:41Z`, SHA-256
`e908fcd12ebb554035a85a415cd1b30fc0174946ca51419e7216646a7dc6522d`.
The root service is active/enabled, PID `36577`, with closure
`40aee251095c46f167894eb74ebb28578bd082d38c3d07c376fa9a1a4e05d7b4`.
It admits Runtime UID/GID 1000 and that exact Runtime digest. The service digest
is `ad975e2238010d98ecb97486158763c34d6b3eef90722f966f1e1e7828ed2420`;
the DRM worker digest is
`f68c1b06c563737cd2253ef0d8a43af1af61a30cbcd43ab3289a5dba663e9a14`.
The physical target is session `16`, seat0/tty2, Wayland `wayland-0`,
1920×1280. The socket is root:1000, mode 0660, beneath a 0750 directory.

Local state is isolated at `/tmp/redeven-device-qualification-desktop`, UI port
24238. Remote deployment uses existing `/home/tang/.redeven` state, so remote
Runtime isolation was not achieved. Cleanup removes task fixtures, channels
and local processes while retaining installed host Runtimes and services.

## Real Functional Evidence

| Interaction | Observed host or Viewer outcome |
| --- | --- |
| Picture | Physical GNOME panel and Clash Verge, then the fullscreen task GTK fixture, appear in the real Viewer. |
| Mouse | A real Viewer click increments the fixture's visible button counter and host event log. |
| Keyboard | Physical `a` press/release reaches GTK; twenty later presses add exactly twenty `a` characters to the host document. |
| Unicode and Enter | In **Use local input method**, CUA sets the real keyboard textarea once to submit an input event; GTK and Viewer show exact `abC中文😀$`, then physical Enter and `second` produce `abC中文😀$\nsecond`. This is assisted commit, not human IME composition acceptance. |
| Lock | Viewer **Lock host** locks GNOME; ordinary controls, clipboard and the editable keyboard surface become disabled. A later observation shows actual lock pixels; the initial black interval has no measured duration or established cause. |
| Physical unlock | **Start unlocking** and physical Enter expose the GNOME password box. One wrong submission keeps the host locked; the authorized correct physical password restores the desktop and `LockedHint=no`. A subsequent click and `x` change the fixture, proving restored input. |
| Shortcut | The first Alt+Tab submission lacked host-effect evidence. A later real shortcut switches from the GTK fixture to Clash Verge and back. Only the latter observations qualify window switching. |
| Fullscreen | The real Viewer enters Electron fullscreen; Escape restores native window controls while retaining the remote picture. |
| Explicit disconnect | Picture is removed, input and shortcut controls are disabled, and **Desktop disconnected** instructs the user to close and reconnect. Closing and reopening from Env App previously restored the picture. |

Credentials are absent from retained fixtures, arguments and records. A real
reload cleared tracing before physical password entry.

### Missing-text diagnosis

CUA `typeText` emitted ASCII events and paste commands; Chinese/emoji never
entered the browser stream. CUA paste sent physical Meta+V to Linux. Restoring
fixture focus and submitting a real textarea input event produced the exact
Unicode document. DevTools observed KeyA/Enter, Viewer commands and native
results; GTK text independently establishes delivery. Neither a production
text-input defect nor real IME behavior was proved.

# Boundaries

## Bounded Measurements And Limits

Temporary DevTools instrumentation runs in the real deployed Viewer, without
source changes. Percentiles below use nearest rank. Ten samples inject
`control.close()` through the current production WebSocket, wait for the
normal reconnect and `HostDesktopPlayer.painted` callback, and allow 750 ms
before the next interruption. A 45-second boundary stops further injections.

| Endpoint | n | P50 | P95 | Maximum |
| --- | --- | --- | --- | --- |
| Control-socket close → recovered Viewer paint confirmation | 10 | 2015.7 ms | 2230.2 ms | 2230.2 ms |

Samples in milliseconds: 1827.1, 2058.5, 2165.0, 2015.7, 1865.4, 1753.7,
2143.3, 2230.2, 2019.2, 1913.1. This includes reconnect scheduling, the SSH
placement bridge, media decode and the production paint-confirmation boundary.
It excludes physical photons and is one short instrumented run. A final reload
clears tracing and the real Viewer again displays the physical desktop in
Control mode. Recovery timing does not qualify initial connection P95.

Command-result aggregation is excluded: `Manager.send` replaces browser IDs
with an independent native sequence and forwards native result IDs unchanged.
Forty apparent numeric matches and a correct GTK document do not establish the
mapping needed for command RTT percentiles. An initial accidentally repeated
instrumentation wrapper was also discarded and cleared before the bounded run.

Thirty pointer-down commands yield no host cursor match within one pixel; CUA
clicks emit no continuous move stream. No feedback percentile or production
defect owner was established. A local responsive cursor does not prove host
feedback timing. Native private-socket/DRM timings remain in the
[AFBC record](remote-desktop-orange-afbc-results.md).

RustDesk and NoMachine were not installed or measured under the same conditions
on udesk26. Source comparison and older native timings do not establish parity,
a 70% CPU reduction, end-to-end input latency or consistent smoothness.

## Orange Failure And Remaining Acceptance

A bounded layered check of configured orange (`192.168.31.134:22`) finds route
en0, the expected ARP MAC, three ICMP replies at 153.169 / 767.083 / 47.908 ms,
and an OpenSSH banner after a 160 ms TCP connection. SSH login and card status
refresh temporarily succeed. This contradicts a permanently unreachable-host
diagnosis; it does not establish a stable transport.

The real Env App open fails with uninformative `[object Object]` details. A
normal card Runtime update progresses to **Checking Runtime service**, then
fails with `write EPIPE`. A subsequent bounded read confirms the installed
binary still reports `8c4f56144a2e`, digest
`6c6b32e8e96878e0c78204101ba6a4c85d23ae6cf7575a6e1d234da85f17d86c`.
The existing service PID `9439` remains active with its older closure and
admitted Runtime digest. No successful current-version deployment is claimed.

The operator later reports Wi-Fi loss and restored connectivity. The
[Orange follow-up](remote-desktop-orange-viewer-results.md) records the repaired
package preparation and successful Runtime update, with remaining service and
Viewer acceptance. EPIPE's precise owner and the prior open-error shape remain
unresolved. Orange's native AFBC and lock/input evidence is preserved.

# Evidence

- `desktop/src/main/remoteDesktopDeployment.ts` and its test: Env App-confirmed installation, Runtime binding and temporary credential scope.
- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js`: production physical/text input, lock controls, reconnect, fullscreen and disconnect behavior.
- `internal/remotedesktop/attachment.go`: current-generation authority, independent native command IDs and unmodified result forwarding.
- Published `host_desktop_player.mjs`: ordered media, host cursor metadata and paint confirmation after RAF and a following task.
- `internal/envapp/ui_src/scripts/checkRemoteDesktopViewer.mjs`: focused Viewer authority and recovery contracts.
