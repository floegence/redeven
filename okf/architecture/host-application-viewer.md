---
type: Interaction Contract
title: Host application viewer state and geometry
description: Present authoritative application state, first pixels, recovery and Xpra window geometry without conflating viewer closure with application termination.
tags: [applications, ui, desktop, runtime]
timestamp: 2026-09-22T05:00:00Z
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


## Xpra window geometry and closure

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

# Boundaries

The viewer cannot infer process termination from an empty inventory or failed
transport. Application minimum sizes, reserved OS shortcuts, inaccessible windows
and browser dismissal permissions remain authoritative.

# Evidence

- `internal/codeapp/appserver/host_application_viewer/`: connection reconciliation, first-frame, terminal and geometry adapters.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts` and `macHostApplicationViewer.test.ts`: backend events, stale callbacks, first-pixel and reconnect acceptance.
- `internal/codeapp/appserver/host_applications_test.go`: owner-authorized terminal snapshots and retained state routes.
