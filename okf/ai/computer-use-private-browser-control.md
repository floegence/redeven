---
type: Architecture Contract
title: Private browser observation and input
description: Fence secret-surface observation, private frames, ordered input and recovery checks around a canonical interaction.
tags: [ai, computer-use, browser, privacy]
timestamp: 2026-09-24T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Runtime owns observer-bound private input and pixels; Floret owns the unresolved
interaction and continuation through the [takeover contract](computer-use-takeover.md).
The user can finish a secret or verification step without exposing its content
to model history. Every operation binds the current observer, viewer revision,
thread, run and target. Unknown input outcomes never replay. Disconnect disables
input immediately; after the canonical answer, Flower resumes in a new Run and
judges the current page through a fresh observation. Private input resumes only
after a newly decoded frame matches the current observer, interaction and target.

# Contract

## Browser observation and private input
The shared browser controller examines visible password fields, `one-time-code` input semantics, CAPTCHA text and explicit instruction-override signals in each frame. An unreadable frame is a technical observation failure, not a human requirement.

See [guided connection](computer-use-browser-connection.md).

# Boundaries

Browser observation is a bounded protection, not proof of atomic safety across all dynamic content. Full product and native IME acceptance remain governed by [Computer use qualification](computer-use-qualification.md).

# Evidence

- `redeven:internal/ai/computer_user_control.go` - authenticated non-model input.

- `redeven:scripts/check_computer_host_safety.mjs` - isolated real-browser safety and private form fixtures with cleanup.

- `redeven:internal/envapp/ui_src/scripts/checkDesktopPrivateComputer.mjs` - isolated built Desktop, scripted provider, real private stream, delayed pixels, header FPS, paste, native IME and handback.
