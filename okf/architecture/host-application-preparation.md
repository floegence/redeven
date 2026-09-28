---
type: Runtime Contract
title: Managed host application preparation
description: Compatible installed components, independent user-directed updates, incremental transfer and same-window first-use preparation.
tags: [runtime, desktop, applications, linux, security]
timestamp: 2026-09-28T17:30:00Z
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

# Contract

## Component ownership and admission

Redeven consumes `github.com/floegence/floe-native-apps` v0.20.0 as a published Go
module, built with the same Go 1.27.1 toolchain. Its embedded catalog pins original
publisher URLs, archive sizes, SHA-256, licenses and source references. The Runtime accepts no client-provided URL, artifact specification,
catalog, executable, or install destination. The upstream acquires original Alpine
APK archives and Xpra HTML5 source, retaining archives in a private cache. Native
binaries are not added to Redeven's source or supplied by a local sibling checkout.

The recommended `DesktopForPlatform` recipe supplies the combined private
Wayland/Xwayland tools, portal services and native input adapters for Linux amd64
and arm64. Desktop's bundled Runtime and receiving Runtime use that same catalog
identity for incremental transfer. The upstream manifest owns original archives,
compiled component hashes, licensing and architecture qualification. No local
sibling source or alternate host installer participates.

Retained Xpra components remain usable by their existing instances; the current
combined recommendation does not replace a loaded backend or input module. New
default launches require the combined capability. The library keeps existing apps
and their controls accessible while preparation is needed for new applications.
Explicit X11-only plans can select the separately verified Xpra capability. Partial
managed and system installations are never merged into a synthetic toolset.

The [host application contract](host-applications.md) owns restoration of the
application's environment, private display isolation and host-owned dependencies.

## Preparation execution and recovery

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

With current combined components installed, the application library remains the primary
surface. An optional update notice opens dependency settings. Required updates use
launch availability to explain that new applications need updated dependencies;
retained-component readiness must not label the page ready to open applications.
The preparation card sizes to its content, with the method and primary action
together. Version identifiers, update rationale and method explanations start
collapsed; errors, recovery actions and active byte progress remain visible.
Inspection is user-directed; dismissing optional updates keeps apps usable.
Complete caches use the explicit `cache` source,
hide download choices and produce no HTTP acquisition or Desktop transfer. Cache
changes fail explicitly; this source cannot silently start a download.

An empty Linux inventory shows that no graphical applications were found, without
promoting dependency installation or optional updates. Component setup installs
neither applications nor a desktop environment. Users can add installed software
or refresh the inventory; collapsed guidance retains explicit component settings
for discovery and manual preparation. Active preparation retains progress and
cancellation; failed or interrupted work retains recovery actions even if the
inventory becomes empty. Discovery failures retain their
error state instead of claiming an empty host. Do not infer Linux support from a
desktop login: installed graphical applications may run on a headless host.

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

The [Desktop component cache contract](../desktop/host-application-component-cache.md)
owns cross-device reuse, seven-day idle retention, the 2 GB archive budget,
process leases and separate cache/download/transfer presentation.

## Window and permission interaction

Selecting an unavailable application presents preparation for that actual app.
When preparation completes, invalidate the previous launch-capability snapshot
before refreshing the catalog. An in-flight session-only refresh must not reuse
the old unavailable state or prevent the pending window from opening once.
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

# Boundaries

Preparation does not install the user's applications or require administrator credentials. Failed or canceled updates retain the compatible active component. Closing a pending viewer withdraws automatic opening, and unqualified staged bytes never become active.

# Evidence

- `internal/hostapps/setup.go`: thin released-library adapter, state placement and complete toolset selection.
- `internal/codeapp/appserver/host_application_setup.go` and `host_applications_test.go`: authenticated status, event and mutation routes.
- `internal/hostapps/linux_desktop.go`: upstream-owned session environment and capability selection.
- `internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.test.tsx`: pending-window continuation and cancellation races.
- `desktop/src/main/hostApplicationPreparationWindows.test.ts`: exact document ownership and inert presentation.
- `desktop/src/main/hostApplicationComponents.test.ts` and `cmd/redeven/host_application_package.go`: Desktop relay and released acquisition delegation.
- `internal/hostapps/component_update_test.go`: retained Xpra update, old process control, migrated recovery and combined new-instance selection.
- `internal/envapp/ui_src/src/styles/hostApplicationUpdates.browser.test.tsx`: all themes/locales, narrow dialogs, keyboard use and accessibility.
- [Upstream v0.6.0](https://github.com/floegence/floe-native-apps/releases/tag/v0.6.0): compatible identities, atomic activation, verified cache plans, incremental ZIPs and native amd64/arm64 legacy-update qualification.
