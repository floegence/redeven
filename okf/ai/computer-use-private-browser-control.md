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

Runtime owns observer-bound private input/pixels; Floret owns takeover/continuation. Bind operations to current observer, revision, thread/run/target; never expose secrets or replay uncertain effects. Disconnect revokes input. Canonical answer starts a new Run with fresh observation; private input additionally waits for decoded matching observer/interaction/target pixels.

# Contract

## Browser observation and private input
The shared browser controller examines visible password fields, `one-time-code` input semantics, CAPTCHA text and explicit instruction-override signals in each frame. An unreadable frame is a technical observation failure, not a human requirement.

See [guided connection](computer-use-browser-connection.md).

# Boundaries

Browser observation is a bounded protection, not proof of atomic safety across all dynamic content. Full product and native IME acceptance remain governed by [Computer use qualification](computer-use-qualification.md).

# Evidence

- `redeven:internal/ai/computer_user_control.go` - authenticated non-model input.

- `redeven:scripts/check_computer_host_safety.mjs` - isolated real-browser safety and private form fixtures with cleanup.
