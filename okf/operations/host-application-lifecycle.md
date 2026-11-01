---
type: Validation Guide
title: Host application lifecycle acceptance
tags: [applications, macos, linux, validation]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Qualify process, window, decoded-frame and authenticated-viewer facts independently under application authorization/window-lifecycle contracts. Only confirmed closure ends physical viewers. Missing/inaccessible surfaces preserve apps and recovery, never retarget processes or inject stale input. Cross-platform operations retain OS differences; this is not all-app certification.

# Contract

Qualify these independent boundaries with native/viewer/API fixtures:

- Reuse an existing single-instance Mac process and preserve it after lease release. A 48-second first-window fixture must wait without relaunch.
- Multiwindow picker counts/literal titles preserve selection/focus; canceled close/quit retains process, pixels, sharing and explicit retry. Last lease release ends sharing, never the application.
- Unreadable/replaced surfaces never expire into closure. Confirmed final-window closure ends established physical viewers. Linux dialog-only apps reveal native-sized decoded dialogs.
- Stale quit selection rejects the whole set before termination. Unknown outcome retains error without inferred exit/retry. Read-only callers may list but cannot quit/detach.
- Network/reload retains process, suspends input/capture, frees buffers and reconnects the same session/current credential. Successor viewer revokes prior input/releases held keys/suspends capture first.
- Permission loss/lock has distinct recovery. Helper exit is sharing failure, not app exit; retire route/credential/buffers/helper before terminal state. Ignore late callbacks and retain unknown-terminal pages.
- Unproven foreground/window identity rejects input without replay/retargeting. Missing decoder negotiates same-process image transport.

Toolbar qualification: fixed bar with resizable content, bounded 320/390/1000 px popovers, keyboard menus, separate close/confirmed quit, late dismissal and no unconfirmed replay. Native quit covers catalog/session controls, visible/windowless apps, cancellation and stale generations.

# Boundaries

Screen-recording and accessibility are explicit macOS grants. Save-dialog cancellation
never permits forced exit. [Distribution evidence](host-application-validation.md)
names tested targets; [platform behavior](../architecture/host-application-behavior.md)
owns OS differences.

# Evidence

- `scripts/check_host_application_lifecycle.mjs`: production assets with controlled
  host streams in Chromium/Firefox/WebKit; records first-frame acknowledgment, state,
  close stack and page closure, without claiming native capture certification.
- `scripts/check_macos_host_application_waiting.py` and
  `scripts/fixtures/nativeHostApplication.swift`: disposable lifecycle scenarios.
- `scripts/check_macos_host_application_termination.py`: exit before/after windows,
  last-window closure with a live process and explicit detach.
