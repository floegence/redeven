---
type: Runtime Contract
title: Host application catalog and owned native sessions
description: Browse Linux and macOS host applications and open owned, reconnectable graphical sessions through existing authorized windows.
tags: [runtime, desktop, applications, security, ui]
timestamp: 2026-09-22T00:00:00Z
---
# Summary

Redeven owns the host application catalog, launch authorization, session lifecycle,
and private forward. The [macOS contract](macos-host-applications.md) defines native
launch and window streaming. On Linux, GIO owns desktop-entry resolution and launch;
Xpra owns X11 rendering and interactive transport. Applications execute
as the Runtime's host OS user, without a container or virtual machine. Each live
application session has one owner and one authorized window route. Closing its
viewer preserves the application and releases native capture and input resources.
Stopping a session is a sharing operation: Linux reclaims its owned Xpra process
group; macOS stops capture and helper ownership while preserving the host
application and its windows. Quitting an application is a separate explicit
operation. Runtime shutdown preserves native macOS applications to protect
unsaved work. Sessions are not durable across Runtime restarts. Missing dependencies,
launch failures, and insufficient permissions fail explicitly.

# Host and application boundary

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
file-transfer, or remote notification forwarding. Xpra owns clipboard and keyboard
behavior; browser permissions and reserved shortcuts still apply.

# Authorization and lifecycle

Catalog and session listing require read permission. Adding an application,
launching, ending, and every forwarded request including the WebSocket require
read, write, and execute permissions under the existing
[Runtime permission gates](runtime-session-permission-gates.md). Ownership comes
from authorized session metadata, never a request-provided user ID. Only the owner
can access or end a session. A per-session Xpra credential independently protects
the loopback WebSocket and is never placed in URLs or catalog responses.

Launching an already active application for the same owner resumes its session.
On Linux, a launch gets a private D-Bus session, virtual X server, authenticated loopback
listener, and process group. A GIO launch receipt, responding HTML5 endpoint, and a nonempty Xpra window
inventory must all be ready before the session becomes running. Startup has a bounded
deadline; failure stops the owned process group and removes its route and secret.
Silent sessions use the released native component library's `XpraNoAudioArgs`
policy to disable audio initialization completely; starting muted must not delay
window readiness on an unavailable audio backend. The same policy applies to
managed and supported system installations. A successful Linux transition records
session creation-to-window readiness and final inventory-query durations in the
Runtime log, identified by session ID. These timings exclude viewer loading and
first decoded pixels; they must not be presented as end-to-end connection latency.
The Runtime limits concurrent sessions to twelve and retains at most forty-eight
session records per Runtime lifetime. Startup failures retain failed status so a
failed launch cannot disappear silently from the library. A previously running
session becomes ended when its server exits normally. An unexpected Xpra process
failure records `capture_failed`, logs the backend exit, and retains failed status
so the viewer shows localized session recovery rather than dismissing itself as a
normal application exit. Both outcomes release the private route and credentials
and reclaim the session's owned process group.

The [Web Service session owner](web-service-browser-sessions.md) provides an
owned ephemeral route that is pinned until application termination, is absent
from saved Web Services, and cannot be saved as a persistent service. It is
released on termination. The manager's target guard also applies to alternative
forward openings to the same target. Runtime shutdown prevents new launches, releases active viewers and capture
resources, and terminates its owned Linux process groups; native macOS applications
remain running. Network loss and viewer closure do not terminate
applications. Runtime crash recovery and attachment to applications previously
started on another display are outside this contract.

# Interaction

Host Applications is available in Activity navigation and the Workbench launcher.
The surface combines searchable category-filtered application cards with running
sessions and explicit resume/end controls. Refresh re-reads host metadata;
visible-session observation uses a lightweight session endpoint. Read-only users
can browse while launch and process controls are disabled. Ending a session asks
for confirmation because unsaved application data may be lost.

On Linux and remote macOS targets, opening uses an application presentation of the existing
[Desktop isolated forward window](../desktop/web-service-browser-window.md), or a
synchronously reserved popup in browser mode. Desktop uses the [application titlebar contract](../desktop/host-application-titlebar.md)
for native window buttons, application controls and content bounds without browser
navigation or an address field. The Xpra document has no Desktop preload or bridge. Only the
Redeven bootstrap receives a narrow, current-window presentation capability as
defined by the Desktop window contract. Browser popups retain browser-owned chrome.

The localized bootstrap owns connection presentation. It uses the host application's
unframed icon with an exclusive fallback, quiet progress motion, and distinct starting, connecting, disconnected,
reconnecting, ended, and failed states. Application content appears only after a
successful Xpra paint acknowledgement or decoded native macOS frame. Loading and
error states share stable icon and title geometry; errors stop progress motion and
provide a separate recovery action without covering the application icon.
Reduced-motion preferences disable motion.
A broken connection provides explicit reconnection, reseeding credentials from the
authorized state endpoint without starting another application process. Stale
callbacks cannot restore a disconnected or superseded view. Terminated sessions
cannot offer an unusable retry. A failed initial Desktop
navigation also has a localized, bridge-free reconnect page.

Terminal documents include an owner-authorized snapshot, without stream credentials.
Reloading a completed session renders its outcome immediately, without a state
request, stream connection, progress animation or futile reconnect action. The page
explains how to open a new session from Host Applications. Close window is offered
only when the Desktop bridge or browser opener permits programmatic dismissal.
An established viewer still closes automatically on confirmed session end; a newly
loaded terminal page remains readable until dismissed. Refresh never launches an app.

After a stream closes, the viewer briefly shows Checking application status while
reconciling once with the authenticated state endpoint. A six-second deadline bounds
this check; late responses cannot override recovery or a newer connection. Confirmed
end/failure, access denial (401/403/423), an unavailable session route (404/410), and
unconfirmed transport failure have distinct presentation and actions. Unavailable
routes never imply application exit. Only live sessions reconnect with freshly read
credentials; malformed successful responses cannot start a stream. Failed sharing
and expired sessions direct users back to the application library. Terminal records
are bounded in memory and do not survive Runtime restart; an expired document route
may no longer be served, and users must reopen from the library rather than rely on
an old viewer URL.


The adapter integrates the selected HTML5 v20/v21 client. It reads
the client binding inside the upstream document, including v21’s lexical global,
without modifying installed upstream assets. Primary normal
windows fill the viewer and track its size through Xpra's window geometry API;
Xpra decorations, wallpaper, toolbar, and loading UI are hidden. Native viewer
chrome owns primary-window movement and the authoritative maximize/minimize state.
Application controls request that state through Xpra metadata; native state changes
are reflected back to Xpra without confusing viewport filling with OS maximization.
Native restore also clears the remote iconified state. Dialog controls remain local
to their dialog. The application still owns
its own client-side header and controls. Transient dialogs retain their stacking, close controls, and input behavior;
oversized dialogs negotiate a bounded size so their actions remain reachable.
Menus and popups keep their ordinary window geometry. No pixel
stretching or cropping substitutes for application resize. Fixed-size or minimum-size
applications can still constrain their own layout. Xpra owns keyboard and clipboard
transport. This path does not create a native OS window per X11 child window.

After Xpra confirms destruction of the final application window, or an established
application session is confirmed ended, the viewer closes its
native window or script-opened browser popup. A close request alone, removal of one
child window, or a lost connection never closes the viewer. Applications retain
their normal save/cancel prompts; cancelling keeps both the session and its viewer.
Closing the outer viewer still preserves the application session.

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

- `internal/hostapps/manager.go` and `desktop.py`: host discovery, process ownership, and Xpra launch.
- `internal/hostapps/manager_test.go` and `desktop_test.py`: lifecycle, installed-stack launch/resume/stop, and literal argument preservation.
- `internal/codeapp/appserver/host_applications.go`, `host_application_viewer/`, and `host_applications_test.go`: API, permission/owner gates, and escaped private bootstrap.
- `internal/portforward/owned_session_test.go`: pinned route lifetime and persistence rejection.
- `internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.tsx` and its tests: library, session controls, permission states, and window opening.
- `internal/envapp/ui_src/src/ui/services/webServiceWindows.ts`: shared authorized window route.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts`: primary/transient geometry, first-paint visibility, reconnect credentials, and stale callback exclusion.
