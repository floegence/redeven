---
type: Development Contract
title: Desktop qualification lifecycle
tags: [desktop, testing, lifecycle, qualification]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The Desktop supervisor owns scenario/resource/cleanup deadlines and final status. Acceptance leaves no owned Electron/Runtime/bridge/fixtures. Preserve production Quit and independent Runtime lifetime; names, generic ports or foreground state grant no stop authority. Timeout/interruption/unexpected exit/force/cleanup/residue fails with retained diagnostics and explicit manifest cleanup.

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
