---
type: Interaction Contract
title: Host application viewer state and geometry
description: Present authoritative application state, first pixels, recovery and Xpra window geometry without conflating viewer closure with application termination.
tags: [applications, ui, desktop, runtime]
timestamp: 2026-09-24T03:00:00Z
---
# Summary

The Redeven bootstrap owns viewer presentation; authenticated Runtime session
state and native backend events own application facts. Pixels appear only after
decoding. A disconnected, inaccessible or stale route never proves application
exit. Reconnection retains process identity and never launches an app. Confirmed
last-window or application closure dismisses an established viewer; a loaded
terminal document instead remains readable. The [shared application contract](host-applications.md)
owns authorization, and the [titlebar contract](../desktop/host-application-titlebar.md)
owns toolbar presentation.

# Contract

## Browser launch admission

The catalog reserves a browser tab in the initiating click and keeps application
identity visible while launch and route admission run. A rejected launch or entry
route leaves that tab open with localized error text, explicit retry in the same
tab, and user-controlled dismissal. Retry uses the host's existing launch
deduplication; closing the tab while admission is pending never cancels or kills
a session that the host may have admitted. A refresh failure is not evidence that
the application ended. Desktop preparation retains its own window ownership.

Launch copy is a typed wire contract. Every field in the Env App presentation
mapping, including touch guidance, must survive the strict Runtime decoder in
every shipped locale. Tests exercise the generated catalog through the actual
launch handler, independently of frontend API mocks. Browser loading documents
explicitly omit Desktop chrome and must not depend on Node globals.

## Connection and terminal presentation

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
The shared connection owner permits automatic dismissal only for the recognized
`application_exited`, `windows_closed` and `sharing_stopped` reasons, after displayed
pixels or an explicit viewer quit request. Unknown end reasons retain the terminal
page; a directly opened tab is never asked to close itself. A close request alone,
removal of one child window and transport loss cannot close the viewer. Save/cancel
prompts remain authoritative. A newly loaded terminal page stays readable until
dismissed, and closing the viewer itself preserves the application. Refresh never
launches an app.

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


## Xpra window geometry and closure

The adapter integrates the selected HTML5 v20/v21 client. It uses the published
`floeXpraInput.getClient()` accessor in the privately prepared upstream document.
Installed upstream assets remain unchanged. Primary normal
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
applications can still constrain their own layout. The
[client input contract](host-application-input.md) owns keyboard/composition and
painted-window binding; Xpra retains pointer and clipboard transport. This path does not create a native OS window per X11 child window.

The released `remote-pointer` controller owns every event in remote pixels. It
maps a touch tap to a click, a CSS-pixel drag beyond its fixed threshold to
vertical/horizontal/diagonal scroll, and a long press to right click or a later
left-button drag. It batches scroll deltas per animation frame and locks each
sequence to a connection-generation/window token. Pointer capture loss,
`pointercancel`, focus or viewport changes, canvas replacement, disconnect and
window destruction reset the controller and release only its held buttons.
Pinch zoom remains a browser gesture; toolbar, window lists and the keyboard
control remain local owners. The Xpra adapter receives only normalized pointer,
button and wheel commands and never runs a second touch recognizer.

Xpra's confirmed destruction of its final application window uses the same
terminal close policy above. The adapter does not infer closure from a missing
paint, a close request or a transport failure.

## LAN decoding and resource reuse

Clarity first requests native display density through the published SDK. On a
high-density viewer, applications render additional pixels with matching private
display DPI and toolkit scale; logical geometry, pointer targets and dialog
controls remain unchanged. The SDK bounds integral density by DPR and the server's
maximum display dimensions, and handles viewport and monitor changes. Redeven
does not implement a second scaling path. Automatic, Smoother motion and Less data
use logical density. Switching modes preserves the connection and application.
Clarity retains adaptive encoding speed and quality 95; mode changes request a
quality-100 refresh so a stationary view can recover exact pixels. Neither high
quality encoding nor HTTPS alone can restore detail absent from the source raster.
Extra pixels consume bandwidth and encoding time, so the picture panel explains
that motion can slow. Application support for live DPI changes remains authoritative.

The picture panel observes the SDK's resolved display notifications and shows its
configured render resolution. This value is not a measured remote frame size or
proof that an application honored live DPI changes. A reduced native density
shows a localized explanation: host display limits suggest making the viewer
smaller; the SDK density ceiling has its own message. Resize and monitor changes
update the same view without polling, quality commands, or refresh requests.
Disconnect revokes the subscription and clears its presentation. Retained clients
without this observation API omit the resolution rather than guessing it.

Saved picture preferences and decoder availability are applied once the client
connects, including when document load precedes the handshake. Selecting the
already selected mode is a no-op. Theme and language updates preserve selection
and focus without sending controls. Limit notices stay inside the scrollable
picture panel and remain readable in narrow or short viewports.

Applications retain their prepared assets across viewer closure and Runtime
updates. If the released display API is unavailable, Clarity first remains usable
and tells high-density viewers to save their work, quit the application and reopen
it. The viewer never rewrites a live application's assets or silently relaunches it.

The picture panel reports video decoding availability from the actual client
encoding list. HTTPS alone does not prove decoder support or a received video
frame. Automatic retains Xpra's adaptive quality/speed semantics. An insecure
browser context explains how to enable HTTPS through Redeven Desktop's environment
access settings, trust the identity on the viewing device and reopen the app.
The [certificate contract](../security/local-ui-certificates.md) owns identity and
trust; the viewer never creates certificates, installs trust, changes the saved
protocol, restarts a Runtime, or silently downgrades TLS.

The published native SDK owns a bounded immutable snapshot of the prepared public
client resources, content hashing, compression, conditional responses and worker
URL relocation. Redeven owns the snapshot for each live Linux application, retaining
it across viewer detach and releasing it when the backend ends. A recovered instance
loads its prepared resources before admitting a new share. The digest includes the
exact prepared input adapter and transformed worker bytes, not merely the component
recipe. Unsupported preparation fails before sharing; there is no unversioned
resource fallback.

Only `/_redeven_proxy/host-application-assets/<digest>/...` may override the normal
no-store policy with private immutable caching. The route requires full permission,
a matching live application owner and exact digest. Env and admitted Host Applications
port-forward origins may access it; codespace, other forward, retired share and
unknown origins cannot. LAN viewers share the stable authenticated Env-origin route,
so a new sharing ID can reuse browser resources. Separate cloud origins retain their
normal browser cache partitioning. Session documents, settings, credentials and
control remain uncached and independently authorized even when scripts are cached.
Detaching still closes all accepted sharing sockets without terminating the app.

The private loopback proxy rewrites the target URL while preserving the sharing
Host and Origin used by the native WebSocket origin check. The standard rewrite
boundary removes untrusted forwarding metadata. Client compression preferences
are removed so the transport can decode HTML before the SDK relocates resource
references; this does not create another authorization or caching path.

## Remote cursor geometry

Published `floe-native-apps` prepares the only Linux cursor owner. Remote PNG
shapes, alpha and complete bounds are retained; their longest edge is at most
24 CSS pixels and smaller images are never enlarged. The hotspot uses the same
scale, is rounded once and remains inside the image. Integral backing density
declared through CSS `image-set()` affects resolution only. DPR and viewport
changes render from the original decoded image, never from an already scaled copy.
CSS cursors and the existing remote pointer use the same normalized result.

One connection owns its current image and decode generation. A newer packet,
reset or disconnect invalidates pending decodes; destroyed windows receive no
late updates, and new windows inherit the current result. Transparent images
remain invisible. Invalid metadata or failed decoding clears the old cursor and
restores the system default without interrupting input. Redeven adds no cursor
size setting, CSS override, mouse listener or second image-processing path.

An existing application keeps its prepared resources and process identity across
viewer closure and Runtime update. The new cursor contract takes effect after
the application exits normally and is launched again. Viewer closure alone does
not upgrade it. macOS native applications retain the client's existing cursor.

# Boundaries

The viewer cannot infer process termination from an empty inventory or failed
transport. Application minimum sizes, reserved OS shortcuts, inaccessible windows
and browser dismissal permissions remain authoritative.

# Evidence

- `internal/codeapp/appserver/host_application_viewer/`: connection reconciliation, first-frame, terminal and geometry adapters.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts` and `macHostApplicationViewer.test.ts`: backend events, stale callbacks, first-pixel, pointer gestures and reconnect acceptance.
- `internal/envapp/ui_src/src/styles/hostApplicationDisplay.browser.test.tsx`: responsive density feedback, localization, keyboard dismissal and control-free display updates.
- `internal/codeapp/appserver/host_applications_test.go`: complete localized launch requests, owner-authorized terminal snapshots and retained state routes.
- `internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.test.tsx` and `src/styles/hostApplicationLaunch.browser.test.tsx`: same-tab failure recovery and localized browser layout.
- `scripts/check_host_application_input.mjs` and `internal/hostapps/client_input_test.go`: released PNG preparation, hotspot coordinates and real application input receipts.

- `internal/hostapps/client_assets_test.go` and `internal/codeapp/appserver/host_application_assets_test.go`: stable resource references, gzip, cache validators, origin/owner/version and revoked permission boundaries.
