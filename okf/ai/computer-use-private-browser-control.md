---
type: Architecture Contract
title: Private browser observation and input
description: Fence secret-surface observation, private frames, ordered input and recovery checks around a canonical interaction.
tags: [ai, computer-use, browser, privacy]
timestamp: 2026-09-24T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

Runtime owns observer-bound private input/pixels; Floret owns takeover/continuation. Bind operations to current observer, revision, thread/run/target; never expose secrets or replay uncertain effects. Disconnect revokes input. Canonical answer starts a new Run with fresh observation; private input additionally waits for decoded matching observer/interaction/target pixels.

# Contract

## Browser observation and private input
The shared browser controller enforces visible password fields, structured
one-time-code input semantics, secret-change latches and explicit permissions in
each frame, including shadow roots. Native adapters enforce platform secure-field
roles. They do not classify ordinary labels or page prose as CAPTCHA, OTP or
instruction attacks. Observed content is untrusted data, never authorization.
The model decides task meaning and whether human help is needed; it never receives
confirmed protected values or pixels for classification. Unmarked secrets are not
guaranteed detectable by accessibility; native apps must expose secure fields and
users retain explicit takeover control. An unreadable frame stops the observation
without inventing a human requirement. Unknown read failures are not retried;
only measured viewport instability has a bounded same-target resampling window.

See [guided connection](computer-use-browser-connection.md).

# Boundaries

Browser observation is a bounded protection, not proof of atomic safety across all dynamic content. Full product and native IME acceptance remain governed by [Computer use qualification](computer-use-qualification.md).

# Evidence

- `redeven:internal/ai/computer_user_control.go` - authenticated non-model input.

- `redeven:scripts/check_computer_host_safety.mjs` - isolated real-browser safety and private form fixtures with cleanup.
