---
type: Development Contract
title: Desktop qualification lifecycle
description: Bound explicit Desktop acceptance and verify cleanup without changing product shutdown semantics.
tags: [desktop, testing, lifecycle, qualification]
timestamp: 2026-10-17T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: the Desktop test supervisor owns scenario termination, resource registration, cleanup deadlines, and final qualification status.
- Outcome: an explicit acceptance run ends within its scenario and cleanup budgets without leaving its Electron, Runtime, bridge, or fixture resources behind.
- Invariants: production Quit confirmation and independent Runtime lifetime remain intact; no process name, generic port, or foreground window grants stop authority.
- Recovery boundary: timeout, interruption, unexpected exit, forced termination, cleanup error, and residual resources fail the run, retain diagnostics, and expose an explicit manifest cleanup command.

# Contract

## One lifecycle owner
Maintained Electron and mixed browser launch entries use `scripts/desktop_test_session.mjs`. Normal completion, assertion failure, scenario deadline, SIGINT, SIGTERM, and worker failure enter the same idempotent cleanup promise.

Runtime target-root registration precedes launch so a startup failure or restarted Runtime remains discoverable through the existing inventory/digest stop contract.

## Cleanup and result ownership
Cleanup releases held requests, requests normal Desktop exit for at most five seconds, then identity-checks TERM and bounded escalation when necessary.

Retry cleanup operates only on the explicit saved manifest and never upgrades its test result.

# Boundaries

No-argument `scripts/check_desktop.sh` selects headless checks. Each broad qualification retains its own assertions, evidence, and original deadline.

# Evidence

- Lifecycle owner: `scripts/desktop_test_session.mjs` and `scripts/desktop_test_processes.py`.

- Failure and identity regressions: `scripts/desktop_test_session.test.mjs`.

- Gate and launch inventory policy: `scripts/desktop_test_session_policy.test.mjs`.
