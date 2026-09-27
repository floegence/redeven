---
type: Runtime Contract
title: Remote browser service recovery
description: Rebuild a failed browser service explicitly while fencing old authority and preserving saved managed tabs.
tags: [architecture, browser, recovery]
timestamp: 2026-09-24T00:00:00Z
---
# Summary

- Authority: ComputerUseRuntime owns browser service generation, process lifetime and recovery admission; the installation manager owns installed bytes.
- Outcome: users recover the browser service without restarting the environment or closing personal Chrome.
- Invariants: old views, tokens and Flower bindings confer no authority in a new generation; uncertain input is never replayed; saved data is not reset.
- Failure boundary: unresolved personal-browser control or privacy reservations block recovery. Failed reconstruction remains failed and requires another explicit action.

# Contract

## Recovery admission and lifetime

The environment response exposes `browser_service.state` and an opaque
`generation`; each browser view carries its generation. The protected browser
recovery operation requires the same read, write and execute permissions as
browser admission and an `expected_generation`. Concurrent and late requests
for the same recovery observe its single result. A request for an unrelated
generation cannot restart the current service.

An accepted recovery belongs to Runtime, independently of HTTP cancellation.
It first stops new old-view operations, revokes browser leases and pauses
affected Flower controls. It then stops owned managed processes and the source
host with bounded process shutdown, drains their consumers together, removes
old workspace identities, and starts a fresh source-host generation. Retired
source events cannot modify the replacement. The configured Flower target
retains a closed identity and reports `connection_required`; recovery does not
grant a new page to an old task.

Personal Chrome is never terminated. A controlled external target, unresolved
input lease, or private opener reservation with possible surviving descendants
blocks recovery before any service state changes. The user must finish that
original browser session; creating a new generation cannot remove the barrier.

## Data and user action

Recovery retains the installed package, website profile, bookmarks, history,
zoom and last committed managed-tab snapshot. Shutdown events cannot replace
that snapshot with an empty directory. Reopening a managed profile restores
eligible saved tabs using new target identities under the
[persistence contract](remote-browser-persistence.md). Unsaved page content and
unsubmitted forms can be lost; the confirmation dialog states this impact.
External pages require a fresh valid selection and are never recreated from
saved URLs. [The surface controller](remote-browser-surface.md) owns the user
action and continuation.

## Managed helper requests

Each managed process has one response reader, request-ID matching, serialized
writes and at most 32 pending requests. Caller cancellation stops that caller's
wait; it does not terminate the shared process. The reader consumes abandoned
responses so another caller cannot receive them. Process exit, malformed
protocol and the independent health deadline retire the process once. An
uncertain tab-creation outcome is reported explicitly and never replayed.
Unexpected managed-process loss marks the same service generation failed and
requires explicit recovery. Intentional disablement or shutdown does not
publish a new fault. Discovery marks failed managed profiles
`connection_required` and offers no default ready candidate until recovery;
losing a single tab leaves the healthy profile available for a new selection.

Unexpected loss of a view's last granted source retires that view and its input
authority. The window stays open with the source-selection recovery action;
an empty directory must not appear as indefinite loading. An explicit tab-close
transaction retains its view until its replacement tab is ready, or retires the
empty view if replacement fails. Other views with healthy sources remain live.

Source retirement retains the semantic navigation guard until the debugger
detaches. Removing its paused-request listener while interception is still
enabled can block restoration and cleanup; input-release failures remain
visible and do not grant a replacement controller.

## Qualification

`scripts/check_browser_qualification.mjs` requires an explicit native catalog
archive (`REDEVEN_BROWSER_TEST_PACKAGE`) and verified installed package
(`REDEVEN_BROWSER_TEST_INSTALLATION`) after the Env App build. It checks pinned
hash, size, marker and executable version, stages the published helper resources,
and executes Runtime, storage/installation, API, UI and real Chrome/Electron
projection cases. Extension coverage includes the real Runtime Native Messaging
bridge, incompatible-version rejection, popup progress and recovery actions,
and the shared connection guide. Historical extension fixtures must verify that
they actually changed the current handshake protocol. A skipped required test, zero assertions, missing required
case or file-load failure rejects qualification. Evidence includes counts,
source identity, dependency version and projection records. The computer
execution gate reuses this same entry point; a missing fixture fails explicitly.

Real product acceptance additionally covers an old-package-only state and both
Desktop and Chrome UI flows. A populated temporary package directory alone does
not prove installation or upgrade behavior.

# Evidence

- `redeven:internal/ai/computer_browser_recovery.go` - Recovery transaction, admission and error codes.
- `redeven:internal/ai/computer_browser_recovery_test.go` - Real process termination, deduplication, saved tabs and privacy barriers.
- `redeven:internal/ai/computer_browser_lifecycle_test.go` - Final-source retirement and healthy-peer isolation.
- `redeven:internal/ai/computer_managed_browser.go` - Process-owned response reader and bounded health handling.
- `redeven:internal/ai/computer_managed_browser_ipc_test.go` - Canceled caller and late-response isolation.
- `redeven:internal/envapp/ui_src/scripts/computerBrowserSource.node-test.mjs` - Navigation guard and input-release retirement ordering.
- `redeven:internal/codeapp/appserver/browser_workspace_api.go` - Authorized recovery operation.
- `redeven:scripts/check_browser_qualification.test.mjs` - Strict executed-test accounting.
