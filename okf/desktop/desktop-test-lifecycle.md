---
type: Development Contract
title: Desktop qualification lifecycle
description: Bound explicit Desktop acceptance and verify cleanup without changing product shutdown semantics.
tags: [desktop, testing, lifecycle, qualification]
timestamp: 2026-10-17T00:00:00Z
---
# Summary

- Authority: the Desktop test supervisor owns scenario termination, resource registration, cleanup deadlines, and final qualification status.
- Outcome: an explicit acceptance run ends within its scenario and cleanup budgets without leaving its Electron, Runtime, bridge, or fixture resources behind.
- Invariants: production Quit confirmation and independent Runtime lifetime remain intact; no process name, generic port, or foreground window grants stop authority.
- Recovery boundary: timeout, interruption, unexpected exit, forced termination, cleanup error, and residual resources fail the run, retain diagnostics, and expose an explicit manifest cleanup command.

# Contract

## One lifecycle owner

Maintained Electron and mixed browser launch entries use `scripts/desktop_test_session.mjs`. Its
supervisor owns `running -> cleaning -> finished`; the worker retains Playwright
handles and fixture release callbacks. Normal completion, assertion failure,
scenario deadline, SIGINT, SIGTERM, and worker failure enter the same idempotent
cleanup promise. Default scenario duration is 180 seconds; long qualifications
declare their existing deadline explicitly.

Resources register immediately after creation, before readiness or assertions.
The session manifest records the run ID, source commit, exact process birth and
executable identity, dedicated process group or child tree, temporary roots,
service owners, and actual ports. Runtime target-root registration precedes
launch so a startup failure or restarted Runtime remains discoverable through
the existing inventory/digest stop contract.

## Cleanup and result ownership

Cleanup releases held requests, requests normal Desktop exit for at most five
seconds, then identity-checks TERM and bounded escalation when necessary. The
test installs a Quit-only native dialog matcher in its own Electron instance
during release. It uses the shipped localized confirmation model; scenario
Cancel and unrelated destructive confirmations keep their real behavior.

The inspector remains attached until product shutdown reaches `will-quit`; only
then does Playwright close its connection. Closing that connection immediately
after the first `app.quit()` can strand asynchronous product shutdown. An
intermediate fixture release uses the same supervisor owner and deadlines.

Runtime, Gateway, bridge, and fixture cleanup proceeds even when another owner
fails. Existing service-stop commands and strict target inventory digests own
service shutdown. Test cleanup does not make Runtime follow production Desktop
exit. Plugin smoke delegates development services to the
[development launcher](desktop-development-bundles.md); attach mode disconnects
only its test connection and preserves attached instances.

Before reporting success, the worker has stopped, exact owned process inventory
is empty, and registered ports bind again. Temporary state is removed only on
verified success. Scenario reports remain provisional until the supervisor
writes cleanup evidence. Recovery after timeout or forced termination never
changes a failed qualification into a pass. Retry cleanup operates only on the
explicit saved manifest and never upgrades its test result.

# Boundaries

No-argument `scripts/check_desktop.sh` selects headless checks. `--ci` remains
explicit; `--full` is required for full Desktop and browser qualification.
Ordinary commit, exact-main push, and cloud source CI run portable lifecycle
or source policy checks without starting real Electron. Each broad
qualification retains its own assertions, evidence, and original deadline.

# Acceptance evidence

On macOS arm64, maintained Playwright typography and native Codespace
scenarios verified their existing assertions and session cleanup. Chromium
branches use the same process owner and failure cleanup. The window-status fixture retained all 120 document, theme,
locale, and viewport cases. The Quit qualification opened a real environment,
canceled Quit and resumed interaction, restarted Runtime, quit normally, and
verified Runtime remained alive until its session owner reclaimed it.

Gateway update fixtures consume the structured service-start response and reject
unexpected commands. Native transport tests preserve explicit recovery intent
through the existing Open owner. Canvas and Flower assertions follow their
current relation and retained-settings contracts; container fixtures use saved
targets rather than replacing the native Local Environment through Presence.
Connection popovers exercise the shared pointer dismissal contract. Runtime or
session replacement refreshes filesystem context and scoped model reads while
health-only snapshots retain both the mounted Flower surface and its requests.
Service-canvas qualification verifies all nine existing scenarios, including
Welcome Open after automatic Runtime startup, window reuse, canvas navigation,
route isolation and reopening, then verifies empty owned inventory.
The [interaction continuity contract](desktop-interaction-continuity.md) owns
the stable Local authority projection and completed-startup Open handoff.

Portable lifecycle tests also run on Linux; the Windows tree adapter has
identity and PID-reuse tests. These do not claim Windows or Linux native
Desktop qualification. Historical or other-task runtimes are outside the
session manifest and remain untouched.

# Evidence

- Lifecycle owner: `scripts/desktop_test_session.mjs` and `scripts/desktop_test_processes.py`.
- Failure and identity regressions: `scripts/desktop_test_session.test.mjs`.
- Gate and launch inventory policy: `scripts/desktop_test_session_policy.test.mjs`.
- Real Quit/Cancel and independent Runtime qualification: `desktop/scripts/check-test-session-quit.mjs`.
- Native fixture and full product acceptance: `desktop/scripts/check-window-status-electron.mjs` and `desktop/scripts/check-service-canvas-window.mjs`.
- Production shutdown contract: `desktop/src/main/desktopQuitImpact.ts` and `desktop/src/main/desktopConfirmation.ts`.
