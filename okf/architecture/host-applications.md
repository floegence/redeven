---
type: Runtime Contract
title: Host application catalog, platforms and preparation
tags: [runtime, desktop, applications, security, ui]
lifecycle: contract
reviewed_at: "2026-11-08"
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

Pause/remove fence new streamed launches and release only that feature's viewers. Applications, installed components, shared OS grants and the other feature survive. Desktop removal also clears its saved preferences; application inventory is retained. Native local application launch remains independent.

When both features are unconfigured, goal-based choices precede authorization; browsing remains available. Setup explains capability purpose and offers one next action. Explicit completion enables access and returns to the list; only selected-app intent opens an app. Background preparation cannot undo pause/removal; dismissal withdraws pending opening but retains grants. Access settings directly shows both feature states and scoped actions; system permissions stay separate. [Launcher interaction](remote-desktop-launcher.md) owns setup and connection presentation.

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
- Preparation names the selected app. Session refresh cannot reuse stale unavailable state or suppress its one pending opening. [macOS](macos-host-applications.md) owns helper/local launch/explicit capture-input permission and requires graphical login.

# Boundaries

The [macOS contract](macos-host-applications.md) owns native launch and capture; the [Linux lifecycle contract](host-application-behavior.md#linux-recovery) owns private display recovery.

Returned icons remain bounded PNG data URIs.

Audio, microphone, webcam, printing and remote notification forwarding remain excluded.

Capability probes, not distribution names, determine Linux readiness. Missing support components block opening until preparation succeeds. macOS requires its native graphical session and permissions; Linux virtual-display assumptions cannot substitute for them.

Preparation never installs user applications. Closing a pending viewer withdraws automatic opening; unqualified staged bytes never activate.

# Evidence

- `internal/hostapps/manager.go`, `linux.go`, `desktop.py` and adjacent tests: discovery, isolated lifecycle, sharing, installed-stack qualification, icons and literal arguments.
- `internal/hostapps/linux_desktop.go`, `launch_failure.go`, `dependencies.go`, `setup.go` and tests: published plan, capability checks, toolset selection, state placement and failure mapping.
- `internal/codeapp/appserver/host_applications.go`, `host_application_setup.go`, viewer and tests: authenticated API, events, owner gates and escaped bootstrap.
