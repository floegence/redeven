---
type: Runtime Contract
title: Host application catalog and owned native sessions
description: Browse Linux and macOS host applications and open owned, reconnectable graphical sessions through existing authorized windows.
tags: [runtime, desktop, applications, security, ui]
timestamp: 2026-09-23T08:00:00Z
---
# Summary

Redeven owns application discovery, authorization and independent sharing.
Applications run as the host OS user without a container or virtual machine.
Closing a viewer, stopping sharing or exiting Runtime preserves the application;
ordinary quit and confirmed force quit are separate explicit actions. Sharing
routes are ephemeral. Surviving Linux instances require verified recovery, while
macOS uses native OS inventory. Missing capabilities and failed capture remain
visible and never imply that an application exited.

# Boundaries

The [macOS contract](macos-host-applications.md) owns native launch and capture;
the [Linux lifecycle contract](linux-application-lifecycle.md) owns private display
recovery. [Env App resource snapshots](../ui/env-resource-cache.md) restore inventory
presentation without granting process or route authority.

The Linux backend uses Xpra 6.x with an HTML5 v20 or v21 client, Xvfb, D-Bus,
xauth, and Python GIO/GTK 3 bindings. The [managed preparation contract](host-application-preparation.md)
owns one-action private component acquisition through the published upstream.
An already compatible complete system installation remains usable. The
[platform and initialization contract](host-application-platforms.md) owns capability
detection, installation boundaries, and distribution validation. A desktop
environment and physical display are unnecessary. The launcher creates a private
virtual X11 display and D-Bus session, clearing inherited desktop display and bus
addresses. The application's files, OS permissions, executable, and home directory
remain those of the Runtime user. This display separation is not an OS sandbox.

GIO supplies standard application metadata, localized names, visibility, executable
resolution, and field expansion. Descriptions and category identifiers come directly
from each host desktop entry. The library derives its entire category filter from
that inventory, preserving unfamiliar identifiers without a product taxonomy or
category-to-description substitution. Missing descriptions remain absent; custom
entries receive no invented categories or icons. Icon lookup uses the host's active
GTK theme, or GTK's standard installed icon paths when no display is available;
Redeven does not force an icon theme. An unresolved icon uses a neutral application
glyph. Terminal-only desktop entries are excluded.
For entries declaring D-Bus activation, a private launch copy disables activation
so GIO executes the declared command within the new display/bus environment; this
avoids delegation to the existing desktop through user systemd services.
Applications without a desktop entry can be registered by absolute executable
path and arguments. Redeven stores these entries in its private application
directory, without changing the host's system menu. Arguments never pass through
a shell; literal percent signs and Desktop Entry quoting are preserved. Custom
entries are shared within this Runtime's host-user catalog.

Applications must support X11 (including GTK/Qt applications with an X11 backend).
Wayland-only applications, applications requiring a full desktop service stack,
singletons that redirect through their own shared profile, hardware-accelerated
graphics, and privileged system controls may require application-specific setup.
The initial integration does not provide audio, microphone, webcam, printing,
file-transfer, or remote notification forwarding. The [client input contract](host-application-input.md) owns composition and keys;
Xpra retains Linux clipboard transport. Browser permissions and reserved shortcuts
still apply.

# Contract

Catalog and session listing require read permission. Adding an application,
launching, ending, and every forwarded request including the WebSocket require
read, write, and execute permissions under the existing
[Runtime permission gates](runtime-session-permission-gates.md). Ownership comes
from authorized session metadata, never a request-provided user ID. Only the owner
can access or end a session. A per-session Xpra credential independently protects
the loopback WebSocket and is never placed in URLs or catalog responses.

Launching an active application for the same owner resumes sharing with that
application. The [Linux instance owner](linux-application-lifecycle.md) separates
its durable private backend from ephemeral sharing. The
[macOS management owner](macos-application-management.md) derives running instances
from the OS. A process, a window, and decoded pixels remain independent facts.

The [Web Service session owner](web-service-browser-sessions.md) provides an owned
ephemeral route pinned until sharing ends. It is absent from saved Web Services
and cannot become a persistent service. Every forwarded request requires the
owner's full permissions. Ending sharing revokes existing upgraded connections as
well as the route and credential. Network loss or outer viewer closure preserves
the application; orderly Runtime shutdown ends sharing without quitting it.
Terminal sharing records remain bounded to forty-eight per Runtime lifetime.

# Interaction

Host Applications is available in Activity navigation and the Workbench launcher.
The surface combines searchable category-filtered application cards with running
applications and explicit resume, stop-sharing and application controls. Refresh
re-reads host metadata; lightweight running snapshots remain independent of
sharing sessions. Read-only users can browse while process controls are disabled.
Stop sharing explains that windows and unsaved work remain open. Ordinary close
or quit respects save cancellation. A separate Force quit confirmation explicitly
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
The whole card opens the application, with a keyboard focus indicator and a
hover/focus affordance; cards do not repeat a visible opening instruction. During
launch, identity and card geometry remain stable while the trailing progress
indicator and screen-reader status communicate activity. Its overlapping-window
navigation icon is distinct from the plugin catalog icon. Application inventory
loading uses matching horizontal skeleton cards and respects reduced motion.

# Evidence

- `internal/hostapps/manager.go`, `linux.go` and `desktop.py`: discovery, instance recovery and sharing ownership.
- `internal/hostapps/manager_test.go` and `desktop_test.py`: lifecycle, installed-stack launch/resume/stop, and literal argument preservation.
- `internal/codeapp/appserver/host_applications.go`, `host_application_viewer/`, and `host_applications_test.go`: API, permission/owner gates, and escaped private bootstrap.
- `internal/portforward/owned_session_test.go`: pinned route lifetime and persistence rejection.
- `internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.tsx` and its tests: library, session controls, permission states, and window opening.
- `internal/envapp/ui_src/src/ui/services/webServiceWindows.ts`: shared authorized window route.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts`: primary/transient geometry, first-paint visibility, reconnect credentials, and stale callback exclusion.
