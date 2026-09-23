---
type: Runtime Contract
title: Managed host application preparation
description: Compatible installed components, independent user-directed updates, incremental transfer and same-window first-use preparation.
tags: [runtime, desktop, applications, linux, security]
timestamp: 2026-09-23T08:00:00Z
---
# Summary

The released `floe-native-apps` library owns Linux graphical component acquisition,
verification, staging, self-check and activation. Redeven owns authenticated product
routes, private state placement, localized preparation and the user's pending app
opening. Applications execute on the host. Preparation never requires a container,
VM, package-manager command, custom software source, or administrator password.
Runtime updates never depend on component updates. Compatible installed components
remain usable during an optional update and after failure or cancellation. A new
installation activates only after verification and real graphical qualification.
Closing a pending viewer prevents automatic application opening.

# Component ownership and admission

Redeven consumes `github.com/floegence/floe-native-apps` v0.6.0 as a published Go
module, built with the same Go 1.27.1 toolchain. Its embedded catalog pins original
publisher URLs, archive sizes, SHA-256, licenses and source references. The Runtime accepts no client-provided URL, artifact specification,
catalog, executable, or install destination. The upstream acquires original Alpine
APK archives and Xpra HTML5 source, retaining archives in a private cache. Native
binaries are not added to Redeven's source or supplied by a local sibling checkout.

The complete toolset lives under `host-applications/native-components`, with its
own loader, Python/GIO/GTK, Xpra/Xvfb, D-Bus and graphical resources. Private wrappers
keep support libraries out of the application's host environment. Linux amd64 and
arm64 share this contract on glibc and musl hosts. Valid managed components take
priority; otherwise a complete compatible system stack remains usable. Partial
managed components are never mixed with system support tools.
The upstream preserves published r1/r2 identities and their compatibility contract
independently of the recommended recipe. r1 remains usable but retains its known
short-frame decoder defect. r2 corrects that defect before qualification; update
copy describes the stability fix without claiming that old running apps are fixed.
Recipe revisions are not separately hosted binary bundles: both reuse the same
original publisher archives. Future SDK upgrades must preserve supported component
contracts rather than equating readiness with the newest digest.

The [host application contract](host-applications.md) owns restoration of the
application's environment, private display isolation and host-owned dependencies.

# Preparation execution and recovery

Reading status, explicitly inspecting a transfer plan and observing events requires read permission. Starting,
transferring or cancelling requires read/write/execute permission through the same
origin and session gates as other Host Applications operations. Owner identity
comes exclusively from authenticated session metadata. The upstream serializes
writers with its private-root lease and enforces owner-scoped cancellation and
idempotent request/chunk admission. Redeven does not keep a second durable
operation store. Installed identity/readiness and operation state are separate:
launch uses the former, never the update stage. Upstream atomically migrates v1
preparation records and recognizes only known, complete historical installations.
Corrupt or unknown records are rejected read-only; damaged installations have a
repair diagnosis. Startup and page/status reads do not download, hash all archives
or run graphical qualification.

One explicit action admits cache verification, missing-file acquisition, extraction
and native qualification in an independent staging directory. Only qualified
components atomically replace the active selection. Old directories remain for live
apps, whose binding follows the [Linux instance contract](linux-application-lifecycle.md).
Events report actual acquisition bytes and stable stages;
the UI does not invent percentage progress for installation or validation. The SSE
observer reads current authoritative snapshots. Losing the observer does not cancel
installation or replay admission. Reconnection observes current state; an uncertain
start response reuses its request ID. A Runtime restart reports interrupted work and
requires explicit continuation, reusing verified archives. Invalid archives, disk
space, filesystem permission, network and graphical self-check failures have
localized recovery copy. No failure changes SELinux, AppArmor or host privileges.
Failure or cancellation preserves installed components and running applications.

With compatible components installed, the application library remains the primary
surface. An optional update notice opens current/recommended versions, the stability
fix and actual missing bytes. Inspection is user-directed; dismissing or ignoring
the notice keeps apps usable. Complete caches use the explicit `cache` source,
hide download choices and produce no HTTP acquisition or Desktop transfer. Cache
changes fail explicitly; this source cannot silently start a download.

When files are missing, the page and application dialog offer host download (selected
by default) and Desktop download-and-transfer. Desktop is disabled with an
explanation outside its component bridge. The selected method is shared between
the page and dialog; failures never switch methods automatically. The compact
preparation surface keeps method descriptions, package size and actions together.
Users can select Desktop initially or explicitly after a host download fails.
Desktop first proves incremental-transfer support, then delegates the exact
receiver digest, architecture and missing archive identities to its bundled Runtime.
Unknown targets fail explicitly without switching source or recipe. The released
SDK creates a bounded ZIP of only missing verified archives. The host independently
verifies uploaded and cached files together before qualification. Full offline ZIP
import remains supported. The initiating Desktop
document owns this local acquisition; navigation or cancellation retires its exact
subprocess and temporary transfer, including cancellation before host admission.
Acquisition byte progress is temporary presentation state; host operation status
remains authoritative. Uncertain upload admissions reuse the same request ID.
An existing receiving operation can resume through an explicitly selected Desktop
transfer or a matching offline package. No renderer-supplied URL or filesystem path can
reach the acquisition command. Browser users and offline deployments may explicitly
select an upstream-generated ZIP in the preparation panel. Uploaded chunks have a
256 KiB bound and the complete archive has the pinned package's bounded ZIP overhead.
The user's local ZIP path is never sent to the host.

# Window and permission interaction

Selecting an unavailable application presents preparation for that actual app.
The confirming click reserves its physical Desktop window or browser popup before
acquisition. The inert view shows the original icon, concise stage copy, real
progress and reduced-motion support. Successful qualification refreshes metadata
and opens the app in that same window. Closing the reservation or leaving its
originating document retires the launch intention; installation may finish for
later use. A late launch response cannot reopen a closed reservation or terminate
the surviving application. Reservations belong to the exact document/application
and cannot be claimed by another document. The
[Desktop window contract](../desktop/web-service-browser-window.md) owns adoption.

macOS never enters Linux component preparation. Its bundled helper, native local
opening and explicit remote screen-recording/accessibility authorization follow the
[macOS contract](macos-host-applications.md); a graphical login is still required.

# Evidence

- `internal/hostapps/setup.go`: thin released-library adapter, state placement and complete toolset selection.
- `internal/codeapp/appserver/host_application_setup.go` and `host_applications_test.go`: authenticated status, event and mutation routes.
- `internal/hostapps/desktop.py`: host application environment restoration.
- `internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.test.tsx`: pending-window continuation and cancellation races.
- `desktop/src/main/hostApplicationPreparationWindows.test.ts`: exact document ownership and inert presentation.
- `desktop/src/main/hostApplicationComponents.test.ts` and `cmd/redeven/host_application_package.go`: Desktop relay and released acquisition delegation.
- `internal/hostapps/component_update_test.go`: authentic r1 update, old process control, migrated recovery and new-instance selection.
- `internal/envapp/ui_src/src/styles/hostApplicationUpdates.browser.test.tsx`: all themes/locales, narrow dialogs, keyboard use and accessibility.
- [Upstream v0.6.0](https://github.com/floegence/floe-native-apps/releases/tag/v0.6.0): compatible identities, atomic activation, verified cache plans, incremental ZIPs and native amd64/arm64 legacy-update qualification.
