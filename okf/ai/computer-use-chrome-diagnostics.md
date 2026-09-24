---
type: Runtime and Product Contract
title: Chrome connection diagnostics and recovery
description: Identify Chrome prerequisites, preserve connection failures, and guide recovery on the actual environment host.
tags: [ai, browser-use, chrome, diagnostics]
timestamp: 2026-09-20T00:00:00Z
---
# Summary

ComputerUseRuntime owns Chrome readiness and its live handshake inventory.
Desktop and Env App present the same host-specific prerequisite and failure
facts. Installed Chrome alone does not establish browser-control readiness.
Missing resources, unavailable graphical sessions, application launch failures,
status-read failures and conversation-continuation failures have separate recovery
instructions. Neither a successful launch nor installation acknowledgement resumes
a task; only a compatible live profile can reach the existing Floret Respond path.
Failures preserve user guidance and never substitute a different browser.

# Contract

## Readiness and diagnostics

`extension/status` reports the environment hostname, platform, Runtime build
version when available, Linux Chrome executable detection, live profiles, prior
preparation and one bounded diagnostic. With no connected profile, the Runtime
checks its authoritative `browser-main` resources before launch prerequisites.
This observation does not start Chrome, stage files, install Chromium or create
conversation state. Resource readiness remains independent of whether the
optional built-in browser is installed or enabled.

The diagnostic contains a closed reason and stage. The authenticated setup,
open and status error envelopes preserve `error_code` and diagnostic `data`.
Failed actions have a correlation ID shared with the Runtime log. The UI accepts
only known reasons and bounded IDs; raw exceptions, command output, paths and
browser content never become error copy. Read-only prerequisite observations do
not invent log events or retained lifecycle state.

Runtime Service epoch 30 pairs these diagnostics with Desktop and Env App.
Epoch 29 follows the existing upgrade path. Native Messaging protocol 6, browser
consent, website grants and database schemas are unchanged.

## Recovery on the environment host

The Chrome overview and connection guide share one compact readiness surface.
Both consume the existing Runtime snapshot, including diagnostics embedded in
`environment.chrome`; the overview must not reduce an explicit blocker to a
generic disconnected state. The surface names the environment once, distinguishes
Chrome detection from extension connectivity, and shows the cause plus one short
recovery instruction. Pairing rules, detailed instructions and copyable technical
diagnostics are disclosed on demand. Installation steps retain their own flow
below this summary.

An absent launch context means this Runtime cannot access a desktop, not that the
machine has no graphical desktop or that Chrome is missing. Product copy must not
infer the user's login state from display environment variables.

Missing helpers or extension assets direct users to update or
reinstall the complete Runtime while keeping data; retry checks readiness after
that repair. Self-managed installations use the matching complete Runtime suite.
The browser installation contract owns [package completeness](computer-use-browser-installation.md).

On Linux, opening Chrome or a folder checks the executable and this Runtime's
`DISPLAY` or `WAYLAND_DISPLAY`. An absent graphical launch context is distinct
from an uninstalled browser. Redeven does not discover or borrow another user's
session. A user may sign in to the environment's desktop, install the staged
extension there and paste the exact connection-page link provided by the guide.
That link carries only the existing native-host configuration. The extension's
Connect action still supplies consent. A connection from the client computer is
not treated as a connection to a remote Runtime.

Opening a native application observes its early process exit. A later failure is
retained in the existing extension hub only if the same launch generation
is current and no profile has connected. Fresh setup and a successful handshake
clear that diagnostic. Closing a process or reporting an error never replays a
browser action. The log records the process exit without capturing page content.

A failed connection check preserves installation steps and the staged folder.
A failed conversation continuation says Chrome connected but the task did not
continue; explicit retry rechecks the live profile before invoking the existing
continuation. Closing the guide or starting another preparation retires stale
responses. Connection observation remains bounded to the open guide; pressing
Connect or copying the manual connection link starts a fresh observation window
after installation, timeout or a failed check.

# Boundaries

A launch or installation acknowledgement cannot resume a task. Only a compatible live profile reaches the existing Floret Respond path. Unreadable status remains a distinct failure and cannot be replaced by readiness inferred from an installed executable.

# Evidence

- `redeven:internal/ai/computer_extension_diagnostics.go` - resource and graphical-session prerequisites.
- `redeven:internal/ai/computer_extension_onboarding.go` - bounded process observation and generation-scoped failure.
- `redeven:internal/ai/computer_extension_diagnostics_test.go` - missing resources, no display and early/late process exits.
- `redeven:internal/codeapp/appserver/computer_extension_diagnostics.go` - safe error envelope and correlated logs.
- `redeven:internal/codeapp/appserver/computer_extension_diagnostics_test.go` - diagnostic contract without private error disclosure.
- `redeven:internal/flower_ui/src/FlowerChromeConnection.tsx` - retained guidance, manual host connection and continuation recovery.
- `redeven:internal/flower_ui/src/FlowerChromeReadiness.tsx` - shared cause-first summary with progressive disclosure.
- `redeven:internal/envapp/ui_src/src/ui/FlowerComputerDialog.browser.test.tsx` - overview blocker visibility, unique environment identity and compact narrow presentation.
- `redeven:internal/envapp/ui_src/src/ui/FlowerComputerConnections.browser.test.tsx` - diagnosis, narrow layout, stale results and handshake-only continuation.
