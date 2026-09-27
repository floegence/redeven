---
type: Interaction Contract
title: Host application viewer state and recovery
description: Present authoritative application state, first pixels, recovery without conflating viewer closure with application termination.
tags: [applications, ui, desktop, runtime]
timestamp: 2026-09-27T00:00:00Z
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


## Rendering ownership

The [display contract](host-application-display.md) owns SDK layouts, density,
cursor coordinates and native window-state mapping. The [viewer resource
contract](host-application-viewer-resources.md) owns share snapshots, capability
restrictions and independent viewer/backend upgrades. First-pixel and terminal
state decisions remain here; neither resource nor geometry notifications prove
application exit.

# Boundaries

The viewer cannot infer process termination from an empty inventory or failed
transport. Application minimum sizes, reserved OS shortcuts, inaccessible windows
and browser dismissal permissions remain authoritative.

# Evidence

- `internal/codeapp/appserver/host_application_viewer/`: connection reconciliation, first-frame, terminal and geometry adapters.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts` and `macHostApplicationViewer.test.ts`: backend events, stale callbacks, first-pixel, pointer gestures and reconnect acceptance.
- `internal/codeapp/appserver/host_applications_test.go`: complete localized launch requests, owner-authorized terminal snapshots and retained state routes.
- `internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.test.tsx` and `src/styles/hostApplicationLaunch.browser.test.tsx`: same-tab failure recovery and localized browser layout.
