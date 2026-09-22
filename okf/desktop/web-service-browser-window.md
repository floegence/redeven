---
type: Runtime Contract
title: Desktop Web Service browser window
description: Present trusted browser chrome around an isolated authorized application view without exposing transport details.
tags: [desktop, managed-services, security, ui]
timestamp: 2026-09-22T02:30:00Z
---
# Summary

Desktop owns the trusted toolbar, isolated target view, navigation admission, and window cleanup. The Runtime's [Web Service session contract](../architecture/web-service-browser-sessions.md) owns the forward identity and authorized route. Reopening the same live forward reuses its window; application content never receives a Desktop bridge. Invalid navigation fails closed, while a marked upstream connection failure exposes a local retry without replacing authorization or restarting the application.

# Contract

When the trusted Desktop Shell bridge is present, Env App requests a semantic Web Service window instead of creating a renderer popup. The request carries the normalized loopback service origin for trusted presentation, but that display value grants no navigation authority. Electron main accepts only absolute HTTP(S) routes that identify the exact forward through the local private origin, browser-only `/pf/<id>` path, or remote `pf-<id>` host allowed for the current Environment. The window exposes a conventional address field, Back, Forward, Reload, Stop, Developer Tools, and explicit Open in browser controls. The address field follows the shared [input focus boundary](../ui/input-focus-boundaries.md); only trusted chrome consumes that CSS asset. The address field always projects the protected route back onto the user's original service origin and current application path; it must not expose Runtime listener ports, private hostnames, `/pf/<id>` prefixes, forward identities, boot routes, entry tickets, or other transport details.

The Desktop loopback gateway preserves application redirects inside that same isolated origin. An absolute or relative `Location` that resolves under the current protected `/pf/<forward_id>/` route is translated back to the equivalent application-root path before navigation. Redirects outside that exact route are not broadened or claimed. This keeps application-owned root redirects functional without exposing the protected transport prefix or granting authority over another Forward.

Each forward window combines a trusted toolbar with a separate target `WebContentsView`. The [Desktop theme contract](desktop-shell-theme-state.md) owns chrome appearance and layout. Target views use a dedicated non-persistent partition, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and no preload. Desktop registers the view with its Environment before navigation. Closing destroys the view, removes request listeners, and clears partition storage and cache. Reopening an unchanged live forward reuses its window.

The Developer Tools button and F12 operate on the target `WebContentsView`, never the trusted toolbar. The conventional macOS `Command+Option+I` and Windows/Linux `Ctrl+Shift+I` shortcuts share the same toggle path. Desktop opens the target inspector detached, reflects its open state in the toolbar, and permits closing it through the same action.

When the port-forward proxy cannot connect to its upstream, it returns a non-cacheable 502 with a Redeven-owned failure marker. Desktop recognizes that marker only on the target view's main document, cancels the raw response, and replaces it with a localized, scriptless local state page. The page states that the Environment was reached but the requested service did not respond, shows the normalized target address, lists service and port checks, and provides a retry intent. Retry immediately changes the button to a localized in-progress state for a short perceptible feedback window, then reloads the original authorized route from Electron main. A delayed retry runs only while the same unavailable page and retry intent remain current, so a new navigation or closed window cannot be overwritten. The local document does not receive a preload, bridge, route URL, or entry ticket. An unmarked 502 from the target application remains application content and must not be reclassified as a connection failure.

Target navigation and popups may remain in the isolated window only while the exact Environment and forward constraints continue to hold. In unified mode, only the user's explicit Open in browser action may hand a retained external target or Runtime-minted browser entry to the system browser. Mint failure, response mismatch, or URL validation failure leaves the Desktop window in place and opens no URL. The target document never receives the Redeven Desktop bridge, Env App preload, or parent Environment partition.

# Host application presentation

The semantic forward-window request optionally selects `presentation: application`.
The default remains the browser presentation described above. Application presentation
uses the shared Desktop titlebar geometry with native OS window buttons, no
browser navigation toolbar, no shell preload, and a target view filling the
complete content area. Its title is the application document title
without the Web Service suffix. The same forward admission, isolated partition,
request routing, window reuse, and teardown remain authoritative. Presentation is
part of reuse identity so opening a different presentation cannot silently retain
an inappropriate window shell. Initial navigation failures provide a scriptless
localized reconnect action without service addresses or browser instructions.
The [host application contract](../architecture/host-applications.md) owns Xpra
geometry, application progress, disconnection, and session lifecycle.

Only the Redeven host-application bootstrap receives a dedicated presentation
preload. It can request close, minimize, maximize, or unmaximize for its own native
window and observe that window's state. The preload applies validated native
titlebar insets to the bootstrap only; fullscreen updates come from the same
authoritative native window events. Electron main binds every request to the
attached live WebContents, its current main frame, and the exact entry origin and
bootstrap path. Subframes, other forwards, navigated documents, and unknown actions
are rejected. The Xpra iframe, native host document, and unavailable document receive
no page bridge. No environment identity, credentials, filesystem, shell, or general
Desktop APIs are exposed. Native event subscriptions are removed with the view. The [application titlebar contract](host-application-titlebar.md) owns control layout, backend command routing and recovery presentation.

# Boundaries

Desktop isolation is a B-level browsing surface over Redeven's existing authorized route; it is not Remote Browser Isolation and does not claim a general-purpose browser security boundary. The browser-only Env App path remains an explicit popup route. Redeven must not label a same-page iframe as complete isolated browsing, copy a reusable RBI implementation into this repository, or bypass the published-dependency policy to obtain one.

System-browser authorization and the persisted access-mode decision remain owned by the session contract; a window cannot create a new route or broaden a forward identity.

# Evidence

- `redeven:desktop/src/shared/desktopShellWebServiceWindowIPC.ts:1` - The semantic Desktop IPC validates HTTP(S) URLs and DNS-safe forward identities.
- `redeven:desktop/src/main/navigation.ts:256` - Desktop recognizes the exact private Web Service route and projects it as the target address.
- `redeven:desktop/src/main/webServiceLoopbackGateway.ts` - The isolated gateway maps redirects for the current protected Forward back to application-root paths without accepting other route identities.
- `redeven:desktop/src/main/main.ts:7916` - Desktop prepares the isolated network partition, owns the trusted browser toolbar and target view, handles marked connection failures and target DevTools, enforces popup/navigation policy, and clears partition storage and cache.
- `redeven:desktop/src/main/webServiceUnavailableDocument.ts:1` - The localized scriptless state page presents the target, recovery checks, and local retry intent without a renderer bridge.
- `redeven:desktop/src/main/hostApplicationWindow.ts` and `hostApplicationWindow.test.ts` - Current-window action admission, native state, and teardown.
- `redeven:desktop/src/preload/hostApplicationWindow.ts` and `hostApplicationWindow.test.ts` - Minimal presentation API restricted to the main bootstrap document.
