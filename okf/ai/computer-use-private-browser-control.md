---
type: Architecture Contract
title: Private browser observation and input
tags: [ai, computer-use, browser, privacy]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Runtime owns observer-bound private pixels/input; Floret takeover/continuation. Bind observer/revision/thread/run/target; disconnect revokes and uncertainty never replays. Canonical answer starts a fresh Run/observation; private input also waits for matching decoded pixels.

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
users retain explicit takeover control. Script navigation receipts require target control and destination grants, not old-page privacy sampling: they return only command/lifecycle facts, never page content. Pure timers also publish no content and send no input. Existing Runtime takeover/permission barriers remain authoritative; ordinary input and all explicit content reads retain full privacy checks. An unreadable frame stops the observation
without inventing a human requirement. Unknown read failures are not retried;
only measured viewport instability has a one-second same-target resampling window
inside the invocation budget. Explicit condition waits own their original deadline
through final publication and resample only typed identity invalidation. Failed
wait samples retain elapsed time and sample count without claiming a condition result.

See [guided connection](computer-use-browser-connection.md).

# Boundaries

Browser observation is a bounded protection, not proof of atomic safety across all dynamic content. Full product and native IME acceptance remain governed by [Computer use qualification](computer-use-qualification.md).

# Evidence

- `redeven:internal/ai/computer_user_control.go` - Source.
- `redeven:scripts/check_computer_host_safety.mjs` - Tests.
