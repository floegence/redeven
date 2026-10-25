---
type: Runtime Contract
title: Linux application instances and independent sharing
description: Preserve owned Linux graphical applications across viewer and Runtime lifetimes, with verified recovery and explicit process termination.
tags: [runtime, applications, linux, lifecycle, security]
timestamp: 2026-09-22T05:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Redeven owns Linux instances, authorization and ephemeral shares; Floe Native Apps owns GIO/process observation. Applications outlive viewers and window count. Closing a share or Runtime never requests termination. Recovery requires original user/private state plus matching kernel process generation and endpoint; persisted PID alone never permits signaling. Reboot, display destruction or external cgroup cleanup can end dependent apps.

# Contract

- Instance records bind opaque ID, authorized owner, metadata, boot/PID/start, component identity and private backend endpoint. Reusable window IDs never grant authority.
- Upstream supervises GIO/descendant/sandbox lifetime. Preparation, launcher failure, app exit, windows and first pixels are separate facts. Xpra retains published readiness/final-window/audio-disable behavior.
- Browser profiles are stable private directories per owner/catalog app. Observed process-tree exit before first window fails launch even with zero status; live processes may keep waiting.
- Linux ordinary control is Close all windows, respecting save/cancel. Explicit force quit never follows close, disconnect, cancellation or uncertain response automatically. Acceptance is not exit proof; remove running rows only after kernel confirmation.

# Boundaries

Reconnect cannot restore destroyed display/OS processes or change ownership policy. Surviving-instance recovery never substitutes a replacement launch.

# Evidence

- `internal/hostapps/linux.go`: records, kernel/endpoint validation, admission, readiness and explicit controls.

- `internal/hostapps/application_proxy.go`: connection revocation including WebSocket hijacks.

- `internal/hostapps/desktop_transport.go` and `desktop_transport_linux_test.go`: authenticated native attachment, bounded correlation and takeover.
