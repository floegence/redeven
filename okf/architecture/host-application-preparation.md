---
type: Runtime Contract
title: Managed host application preparation
description: One-action acquisition, verification, cancellation, offline recovery and same-window launch continuation for native host applications.
tags: [runtime, desktop, applications, linux, security]
timestamp: 2026-09-20T15:00:00Z
---
# Summary

The released `floe-native-apps` library owns Linux graphical component acquisition,
verification, staging, self-check and activation. Redeven owns authenticated product
routes, private state placement, localized preparation and the user's pending app
opening. Applications execute on the host. Preparation never requires a container,
VM, package-manager command, custom software source, or administrator password.
Only a verified installation whose real window, decoded pixels and input receipt
pass self-check becomes ready. Failure preserves an explicit retry boundary;
closing a pending viewer prevents its automatic application opening.

# Component ownership and admission

Redeven consumes `github.com/floegence/floe-native-apps` v0.1.2 as a published Go
module. Its embedded catalog pins original publisher URLs, archive sizes, SHA-256,
licenses and source references. The Runtime accepts no client-provided URL, hash,
catalog, executable, or install destination. The upstream acquires original Alpine
APK archives and Xpra HTML5 source, retaining archives in a private cache. Native
binaries are not added to Redeven's source or supplied by a local sibling checkout.

The complete managed toolset lives under the Runtime's
`host-applications/native-components` state. It carries its own musl ELF loader,
Python, GIO/GTK, Xpra, Xvfb, D-Bus, X authorization, keyboard data, image loaders and
fonts. Private wrappers select package-relative resources without setting a global
library path. Linux amd64 and arm64 use the same acquisition contract regardless
of whether the host uses glibc or musl. A valid managed installation takes priority;
otherwise an already compatible complete system stack remains usable. A partial
managed installation is never mixed with system support components.

The GIO application launcher restores the original host tool/library environment
from upstream's explicit saved map before executing user software. The session's
private display and D-Bus addresses remain. Actual application metadata, binaries,
files, toolkit dependencies and OS permissions remain host-owned. This is display
isolation, not a security sandbox or an application compatibility layer.

# Preparation execution and recovery

Reading preparation status and observing events requires read permission. Starting,
transferring or cancelling requires read/write/execute permission through the same
origin and session gates as other Host Applications operations. Owner identity
comes exclusively from authenticated session metadata. The upstream serializes
writers with its private-root lease and enforces owner-scoped cancellation and
idempotent request/chunk admission. Redeven does not keep a second durable
operation store.

One explicit preparation action admits download, integrity verification, extraction
and native qualification. Events report actual acquisition bytes and stable stages;
the UI does not invent percentage progress for installation or validation. The SSE
observer reads current authoritative snapshots. Losing the observer does not cancel
installation or replay admission. Reconnection observes current state; an uncertain
start response reuses its request ID. A Runtime restart reports interrupted work and
requires explicit continuation, reusing verified archives. Invalid archives, disk
space, filesystem permission, network and graphical self-check failures have
localized recovery copy. No failure changes SELinux, AppArmor or host privileges.

If a user-initiated host download fails and Desktop's component bridge is available,
Desktop acquires the same architecture catalog through its bundled Runtime. It
transfers original verified archives as a bounded ZIP through the authorized host
API. The host independently verifies and qualifies them. The initiating Desktop
document owns this local acquisition; navigation or cancellation retires its exact
subprocess and temporary transfer. No renderer-supplied URL or filesystem path can
reach the acquisition command. Browser users and offline deployments may explicitly
select an upstream-generated ZIP in the preparation panel. Uploaded chunks have a
256 KiB bound and the complete archive has the pinned package's bounded ZIP overhead.
The user's local ZIP path is never sent to the host.

# Window and permission interaction

Selecting an unavailable application presents preparation for that actual app.
The confirming click reserves its physical Desktop window or synchronous browser
popup before acquisition. The view uses the original unframed icon, concise stage
copy, a thin progress indicator, real download progress and reduced-motion support.
When qualification succeeds, the library refreshes actual metadata and opens the
app in that same window. Closing the preparation window or leaving its originating
document retires the launch intention. If a new launch response arrives after its
window has closed, Redeven ends only the newly created session. Existing sessions
are not stopped by that race. Installation may finish independently for later use.

The Desktop reservation is scoped to the exact Env App document and application.
Another document cannot claim it. It has no preload, application bridge, browser
address bar or interactive remote content. On adoption, the existing isolated
application viewer fills the same native window and retains the normal
[application lifecycle](host-applications.md).

macOS already ships its native helper. Local Desktop opening continues without
capture permissions. Remote use guides explicit screen-recording and accessibility
authorization, retains the selected app and resumes after the actual host preflight
passes. Permission grants still require the host user's macOS interaction; Redeven
cannot silently grant them. A graphical login remains required, as defined by the
[macOS contract](macos-host-applications.md).

# Evidence

- `internal/hostapps/setup.go`: thin released-library adapter, state placement and complete toolset selection.
- `internal/codeapp/appserver/host_application_setup.go` and `host_applications_test.go`: authenticated status, event and mutation routes.
- `internal/hostapps/desktop.py`: host application environment restoration.
- `internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.test.tsx`: pending-window continuation and cancellation races.
- `desktop/src/main/hostApplicationPreparationWindows.test.ts`: exact document ownership and inert presentation.
- `desktop/src/main/hostApplicationComponents.test.ts` and `cmd/redeven/host_application_package.go`: Desktop relay and released acquisition delegation.
- [Upstream v0.1.2](https://github.com/floegence/floe-native-apps/releases/tag/v0.1.2): pinned component catalog, integrity/extraction and native qualification implementation.
