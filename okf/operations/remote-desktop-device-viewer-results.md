---
type: Qualification Record
title: Physical-device remote desktop Viewer qualification
description: Assess deployed udesk26 Viewer behavior and bounded recovery timing while preserving IME, cursor and comparison limits.
tags: [desktop, input, deployment, latency, qualification]
timestamp: 2026-10-11T15:54:39Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Native v0.22.34 on udesk26 qualifies picture/input, assisted Unicode, physical unlock, switching, disconnect/fullscreen and ten interrupted-control recoveries. Locked/disconnected input stays disabled until fresh paint. Orange follow-up owns later updates. Real IME, matched cursor, command RTT, complete Orange acceptance and RustDesk/NoMachine parity remain unqualified.

# Contract

## Deployment And Host Identity
On 2026-10-11 the task Desktop used card **Actions → Update** for udesk26, then the real Env App administrator-authorized service deployment.

Cleanup removes task fixtures, channels and local processes while retaining installed host Runtimes and services.

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

### Missing-text diagnosis

# Boundaries

## Bounded Measurements And Limits
Temporary DevTools instrumentation runs in the real deployed Viewer, without source changes.

| Endpoint | n | P50 | P95 | Maximum |
| --- | --- | --- | --- | --- |
| Control-socket close → recovered Viewer paint confirmation | 10 | 2015.7 ms | 2230.2 ms | 2230.2 ms |

It excludes physical photons and is one short instrumented run.

No feedback percentile or production defect owner was established.

## Orange Failure And Remaining Acceptance
A bounded layered check of configured orange (`192.168.31.134:22`) finds route en0, the expected ARP MAC, three ICMP replies at 153.169 / 767.083 / 47.908 ms, and an OpenSSH banner after a 160 ms TCP connection.

Orange's native AFBC and lock/input evidence is preserved.

# Evidence

- `desktop/src/main/remoteDesktopDeployment.ts` and its test: Env App-confirmed installation, Runtime binding and temporary credential scope.

- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js`: production physical/text input, lock controls, reconnect, fullscreen and disconnect behavior.

- `internal/remotedesktop/attachment.go`: current-generation authority, independent native command IDs and unmodified result forwarding.
