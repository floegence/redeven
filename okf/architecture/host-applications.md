---
type: Runtime Contract
title: Host application catalog, platforms and preparation
tags: [runtime, desktop, applications, security, ui]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Redeven authorizes catalog, instances and independent shares; published native libraries own platform execution and preparation. Host Applications is available in Activity navigation and the Workbench launcher. Full-permission `PUT /_redeven_proxy/api/{host-applications,remote-desktop}/access` requires an explicit state.

# Contract

## Catalog
Catalog and session listing require read permission. Ownership comes from authorized session metadata, never a request-provided user ID.

Terminal sharing records remain bounded to forty-eight per Runtime lifetime.

A separate Force quit confirmation explicitly warns that unsaved work is lost; it never follows cancellation automatically.

Application inventory loading uses matching horizontal skeleton cards and respects reduced motion.

## Feature access
Persisted `host_access.applications` and `host_access.desktop` independently record `unconfigured`, `enabled`, or `paused`. First catalog/status read initializes missing legacy states from passive capability/session evidence; later grants cannot change intent. Startup restores both gates.

Pause fences new streamed launches and releases only that feature's viewers, retaining preferences. Apps, components, shared OS grants, application inventory and the other feature survive. Legacy `unconfigured` remains supported by both APIs; the desktop API also clears display/approval-reuse preferences. Neither feature exposes reset/removal in the UI. Local launch stays independent.

When both features are unconfigured, goal choices precede authorization; browsing remains available. Setup explains capability purpose and one next action. macOS settings/restart paths are explicit and preserve selected-app intent. Confirmed helper restart ends shares, retains access intent/apps, and requires reconnection. Explicit completion enables access and returns to the list; only selected-app intent opens an app. Background preparation cannot undo disabled access; dismissal withdraws opening, not grants.

An icon-only application-header gear has a localized name/tooltip and opens independent feature states with one setup/resume action each. Before readiness, only explicit setup exposes missing permissions/components; hide picture tuning. Optional collapsed application-picture settings belong to enabled Applications, never Desktop. Persistent desktop authorization requires enabled/ready Desktop. Shared permission maintenance is collapsed while either feature is usable. Collapse, pause, readiness loss or category exit retires portals/mutation authority, preserving drafts; return never reopens tuning or replays writes. Returning from macOS Settings refreshes permissions and both feature summaries. [Launcher interaction](remote-desktop-launcher.md) owns setup/connection presentation.

## Platforms
### Immutable launch plan
GIO resolves the authorized desktop entry. A sandbox launcher requiring metadata fails clearly when metadata is absent; a custom wrapper is not proof that the underlying package is supported.

The [preparation owner](#preparation) selects complete components.

### Private graphics and host services
Each instance owns unique private display/socket, authorization, runtime and bus resources.

It never exposes the whole desktop bus or arbitrary process management.

Support claims require real package and desktop evidence, as recorded in the [validation owner](../operations/host-application-validation.md#retained-xpraplatform-matrix).

### macOS initialization
The [native macOS contract](macos-host-applications.md) owns local launch, remote single-window capture, input, and graceful lifecycle. macOS 13 or newer uses the packaged `redeven-computer-host` helper.

A Mac without a graphical login cannot create a private headless AppKit session. Native AppKit applications do not become X11 applications by installing XQuartz, and Xpra desktop shadowing is not this implementation.

## Preparation
- `go.mod` owns exact dependency/toolchain versions. Never combine partial managed/system installations. [Applications](#catalog) owns environment restoration, private displays and dependencies.
- Status, explicit transfer-plan inspection and observation require Read. Upstream serializes writers with a private-root lease and owns scoped cancellation/idempotent chunks. [Desktop cache](../desktop/host-application-component-cache.md) owns cross-device reuse, seven-day/2GB policy and separate progress.
- Shell owns preparation admission, Desktop acquisition, upload and observation; views own selected-app opening intent. Page disposal only withdraws automatic opening. Explicit Cancel alone requests host cancellation; environment retirement fences results and stops transport. Lost events reconcile status while work is active. Preparation names the selected app. Session refresh cannot reuse stale unavailable state or suppress its one pending opening. [macOS](macos-host-applications.md) owns helper/local launch/explicit capture-input permission and requires graphical login.

# Boundaries

The [macOS contract](macos-host-applications.md) owns native launch/capture; [Linux lifecycle](host-application-behavior.md#linux-recovery) owns display recovery. Icons are bounded PNG data URIs. Audio, microphone, webcam, printing and notification forwarding remain excluded.

Linux readiness uses capability probes; missing components block opening. macOS requires a native graphical session/permissions. Preparation never installs user apps or activates unqualified bytes. Closing a pending viewer withdraws automatic opening.

# Evidence

- `internal/hostapps/manager.go`, `linux.go`, `desktop.py` and adjacent tests: discovery, isolated lifecycle, sharing, installed-stack qualification, icons and literal arguments.
- `internal/hostapps/linux_desktop.go`, `launch_failure.go`, `dependencies.go`, `setup.go` and tests: published plan, capability checks, toolset selection, state placement and failure mapping.
- `internal/codeapp/appserver/host_applications.go`, `host_application_setup.go`, viewer and tests: authenticated API, events, owner gates and escaped bootstrap.
