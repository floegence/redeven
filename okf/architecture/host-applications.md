---
type: Runtime Contract
title: Host application catalog and owned native sessions
description: Browse Linux and macOS host applications and open owned, reconnectable graphical sessions through existing authorized windows.
tags: [runtime, desktop, applications, security, ui]
timestamp: 2026-10-01T00:00:00Z
---
# Summary

Redeven owns application discovery, authorization and independent client sharing
leases. Applications run as the host OS user without a container or virtual
machine. Opening an application always admits or resumes sharing for the current
client; closing that client's viewer releases only its lease and preserves the
application. The last lease ends the route and transport without stopping the process;
ordinary quit and confirmed force quit are separate explicit actions. Sharing
routes are ephemeral. Surviving Linux instances require verified recovery, while
macOS uses native OS inventory. Missing capabilities and failed capture remain
visible and never imply that an application exited.

# Boundaries

The [macOS contract](macos-host-applications.md) owns native launch and capture;
the [Linux lifecycle contract](linux-application-lifecycle.md) owns private display
recovery. [Env App resource snapshots](../ui/env-resource-cache.md) restore inventory
presentation without granting process or route authority.

Linux consumes published private Wayland/Xwayland and retained Xpra capabilities.
The [managed preparation contract](host-application-preparation.md) owns private
component acquisition; [platform initialization](host-application-platforms.md)
owns immutable launch plans, package identity and limited host-service access.
Native host applications need no physical display or complete desktop. Sandboxed
packages still need their installed runtime and required host services. Private
graphics is not an OS sandbox and does not change the user's files or permissions.

GIO supplies standard application metadata, localized names, visibility, executable
resolution, and field expansion. Descriptions and category identifiers come directly
from each host desktop entry. The library derives its entire category filter from
that inventory, preserving unfamiliar identifiers without a product taxonomy or
category-to-description substitution. Missing descriptions remain absent; custom
entries receive no invented categories or icons. Icon lookup uses the host's active
GTK theme and its normal inheritance first, or GTK's standard search paths when
no display is available. Missing or unreadable named icons are then looked up in
installed application icon themes, in search-path order and stable theme-name
order. Independent theme objects preserve the host's active theme; cursor-only
and invalid themes are ignored. Absolute file icons keep their declared source.
The published native component supplies standalone SVG decoding and PNG encoding;
installing the current component recipe is required for that capability. Returned
icons remain bounded PNG data URIs. An unresolved icon uses a neutral application
glyph. Terminal-only desktop entries are excluded.
For entries declaring D-Bus activation, a private launch copy disables activation
so GIO executes the declared command within the new display/bus environment; the published planner
then owns package-specific scope/portal adaptation without adopting external windows.
Applications without a desktop entry can be registered by absolute executable
path and arguments. Redeven stores these entries in its private application
directory, without changing the host's system menu. Arguments never pass through
a shell; literal percent signs and Desktop Entry quoting are preserved. Custom
entries are shared within this Runtime's host-user catalog.

Support for native packages, Snap, Flatpak, AppImage, Wayland and Xwayland is
bounded by real [platform evidence](../operations/host-application-platform-validation.md).
Application-specific singleton, hardware, permissions and desktop service limits
remain explicit. No failure retries the application with a second backend. The
[client input contract](host-application-input.md) owns composition, keys and
clipboard. Browser permissions and reserved shortcuts still apply. Audio,
microphone, webcam, printing and remote notification forwarding remain excluded.

# Contract

Catalog and session listing require read permission. Adding an application,
launching, ending, and every forwarded request including the WebSocket require
read, write, and execute permissions under the existing
[Runtime permission gates](runtime-session-permission-gates.md). Ownership comes
from authorized session metadata, never a request-provided user ID. Only the owner
can access or end a session. A per-session sharing credential independently protects
the loopback WebSocket and is never placed in URLs or catalog responses.

Launching an active application for the same owner and client resumes that
client's lease. A different client receives an independent lease while reusing
the same application process. The [Linux instance owner](linux-application-lifecycle.md) separates
its durable private backend from ephemeral sharing. The
[macOS management owner](macos-application-management.md) derives running instances
from the OS. A process, a window, and decoded pixels remain independent facts.

The [Web Service session owner](web-service-browser-sessions.md) provides an owned
ephemeral route pinned until that lease ends. It is absent from saved Web Services
and cannot become a persistent service. Every forwarded request requires the
owner's full permissions. Ending a lease revokes existing upgraded connections as
well as its route and credential. A network interruption keeps the lease available
for reconnect. The unload release uses a short host-side grace so a browser reload
can read the current state and retain the same lease; an explicit outer viewer
close releases only that client. Orderly
Runtime shutdown ends sharing without quitting applications.
Terminal sharing records remain bounded to forty-eight per Runtime lifetime.

# Interaction

Host Applications is available in Activity navigation and the Workbench launcher.
The surface combines searchable category-filtered application cards with running
applications and explicit Open/Resume and application controls. Refresh
re-reads host metadata; lightweight running snapshots remain independent of
sharing sessions. Read-only users can browse while process controls are disabled.
Closing the viewer is implicit lease release; the running process remains visible
and Open/Resume opens the current client's viewer again. Ordinary close or quit
respects save cancellation. A separate Force quit confirmation explicitly
warns that unsaved work is lost; it never follows cancellation automatically.

On Linux and remote macOS targets, opening uses an application presentation of the existing
[Desktop isolated forward window](../desktop/web-service-browser-window.md), or a
synchronously reserved popup in browser mode. Desktop uses the [application titlebar contract](../desktop/host-application-titlebar.md)
for native window buttons, application controls and content bounds without browser
navigation or an address field. The Xpra document has no Desktop preload or bridge. Only the
Redeven bootstrap receives a narrow, current-window presentation capability as
defined by the Desktop window contract. Browser popups retain browser-owned chrome.

The [application viewer contract](host-application-viewer.md) owns connection,
waiting, first-pixel, terminal-state and Xpra geometry behavior. Reload and retry
never launch an application; only explicit library opening admits a launch.

The library uses compact horizontal cards: an unframed host icon, vertically
centered identity, and a trailing action or session indicator. Descriptions appear
only when supplied by the host; missing metadata never reserves an empty description
area. Long names wrap to at most two lines and expose the full name in their title
and accessible action label. The responsive grid fits narrow widget surfaces.
Below 768 CSS pixels, the page header keeps the title and icon actions on one
56px row, omits the repeated eyebrow and description, and keeps the running
application section's status rows compact so the library search remains close
to the primary content.
The whole card opens the application, with a keyboard focus indicator and a
hover/focus affordance; cards do not repeat a visible opening instruction. During
launch, identity and card geometry remain stable while the trailing progress
indicator and screen-reader status communicate activity. Its overlapping-window
navigation icon is distinct from the plugin catalog icon. Application inventory
loading uses matching horizontal skeleton cards and respects reduced motion.

# Evidence

- `internal/hostapps/manager.go`, `linux.go` and `desktop.py`: discovery, instance recovery and sharing ownership.
- `internal/hostapps/manager_test.go` and `desktop_test.py`: lifecycle, installed-stack launch/resume/stop, managed/system icon decoding and theme priority, and literal argument preservation.
- `internal/codeapp/appserver/host_applications.go`, `host_application_viewer/`, and `host_applications_test.go`: API, permission/owner gates, and escaped private bootstrap.
- `internal/portforward/owned_session_test.go`: pinned route lifetime and persistence rejection.
- `internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.tsx` and its tests: library, session controls, permission states, and window opening.
- `internal/envapp/ui_src/src/ui/services/webServiceWindows.ts`: shared authorized window route.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts`: primary/transient geometry, first-paint visibility, reconnect credentials, and stale callback exclusion.
