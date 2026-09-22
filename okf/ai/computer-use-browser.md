---
type: Browser Integration Contract
title: Managed browsers and authorized Chrome tabs
description: Bind an explicit profile and tab to the Runtime while preserving login state and unrelated user browsing.
tags: [ai, browser-use, chrome, profiles]
timestamp: 2026-09-22T00:00:00Z
---
# Summary

`ComputerUseRuntime` owns browser connections, authorization and target control.
Managed Chromium, explicit CDP and Chrome extension bindings share the same
restricted page executor. A selected tab never implies authority over sibling
tabs or a different device. Disconnect, revocation, closed tabs and uncertain
effects stop subsequent work without automatically selecting a replacement.

# Contract

Connecting an explicitly chosen tab or creating a new tab in Browser and desktop
also selects that target for the current conversation. Full access already permits
HTTP/HTTPS sites; other modes use separate saved grants. Delayed connection results cannot select a different
conversation after navigation.

The [Connect Chrome guide](computer-use-browser-connection.md) prepares the
native connection, walks through installation and confirmation, and observes the
real handshake before resuming the original Floret interaction. It never binds
a tab or creates a second conversation lifecycle. Native opening commands use
fixed destinations; managed Chromium launches with its sandbox enabled.

**View in browser** is an authenticated user action on the current connected target.
Runtime verifies thread ownership, selection, policy and occupancy under the target
gate. The extension activates that exact tab and its window; explicit CDP uses
`Page.bringToFront`. Reveal grants no site access or private input and does not
change selection. It is not a model tool or a second browser-opening path.

## Managed profiles

The Runtime owns one persistent headless Chromium process per profile. A new tab
uses that process, shares its login state, and receives its own target identity.
Different profiles use separate data directories. The default profile creates
its first page lazily; later loss of a selected page fails explicitly. Neither
an inventory request nor a helper restart chooses the first available page.

User-facing connection management lists profiles and tabs, creates named managed
profiles and creates inactive tabs. Existing tabs require an explicit Agent or user selection.
Profile creation does not grant sites or change a thread's target. Bounded
profile metadata lives with browser profile data; it is not Agent history.
Malformed, oversized or redirected metadata is rejected without rewriting it.
Closing a tab helper leaves its profile and sibling tabs alive. Runtime shutdown
closes tab helpers before their profile owners.

The managed/CDP target helper borrows its root and child debugger transports
from the released FloeBrowser source adapter. Semantic inspection and DOM
projection can consume that same source without a second attachment or frame
owner. Disposing a projection preserves the source and AI connection. Removing
a child frame retires its semantic listeners, context ownership and references;
late completion from that retired frame cannot invalidate a healthy parent.
The extension applies the same semantic-session retirement to its own debugger
children. Source adaptation itself grants neither observation nor user input.

Managed downloads use opaque unique filenames beneath the owned profile's
download directory. `browser.waitForDownload` waits for completion events and
returns the filename, state and saved path only after the file is confirmed.
A cancelled or unavailable download is explicit. Files survive browser shutdown.
Navigations returning a download are not forced to wait for a nonexistent page
load event. The guest cannot choose filesystem destinations or read file bytes;
a later authorized file/command tool handles data processing.

## Chrome extension and explicit CDP

The MV3 extension uses Native Messaging and `chrome.debugger` bound to an exact
tab. Setup registers a native host for the current machine; the relay forwards
framed protocol-6 messages over a private local Unix socket to the Runtime.
Only the packaged extension origin may establish this connection. Its own popup
confirms the first connection; later starts restore that exact confirmed host as
described in the [connection guide](computer-use-browser-connection.md). Setup
and transport recovery do not create a thread grant or attach any tab.

The extension requires a completed Runtime handshake before reporting connected.
Its webNavigation creation events retain bounded, in-memory popup source facts;
Chrome tab-group opener metadata is not treated as the source of an action.
It exposes Runtime-owned inventory and bind/new-tab/disconnect/reveal commands.
Flower and connection management share the candidate selection path.
The Runtime owns the resulting opaque profile and target identities. Different
tabs may execute concurrently, while one tab executes only one invocation at a
time. Cancellation is scoped to one request. Reconnect drains cancelled old
requests before rebinding; old responses and detach notifications cannot retire
a new connection. Native-host cleanup removes only the exact registration bytes
written by the closing Runtime.

New work creates an inactive tab in the chosen profile. Page commands do not
activate a window, select a foreground tab, use the system clipboard or move
the OS mouse. Top-level CDP focus emulation makes the background page ready for
keyboard interaction without selecting its tab; private control and disconnect
release that override. Existing extension tabs must still match the selected
inventory URL and title both before and after attachment. Changed selections
fail and require a refreshed inventory; attachment never reloads the page.
Incidental keyboard or pointer activity does not pause automation. Flower Stop,
explicit takeover, revoked access and lost targets still stop subsequent work.
Injected key/button presses are balanced on cancellation; unconfirmed cleanup
is an unknown effect. The isolated-world observer tracks sensitive-field
transitions, including fields inserted and removed during one action.

Read failures use one shared controller for managed and connected browsers.
A changed frame invalidates the observation; a stable failure permits one
readonly retry before returning `TARGET_OBSERVATION_UNAVAILABLE`. Both adapters
retain only confirmed effect progress and the closed inspection stage, never
raw exceptions, semantic content or pixels. Runtime logs these non-secret facts
with the target identity and viewer/tool source. Read failure does not acquire
user control. Lost navigation interception requires reconnection and cannot
masquerade as the user taking control. Older helper/extension protocols are
rejected; Runtime Service epoch 25 is unchanged because its wire shapes and
existing unavailable-frame UI contract are unchanged.

Initial CDP connection requires authenticated endpoint, profile and tab selection.
Thereafter Agent discovery can choose existing tabs or create independent task
pages in that connected profile. Inventory and
attachment use Playwright `noDefaults`, preserving the existing browser's
focus, download and media settings. Each CDP endpoint/profile/tab has one stable adapter. Connecting another tab
never replaces an adapter owned by another conversation. Failure preserves the
previous binding. Closing a CDP connection does not close the user's browser.

Connected Chrome downloads follow Chrome's existing policy. The model sees only
selected-tab download metadata, not arbitrary download history or filesystem
paths. The extension offers no raw CDP, cookie or cross-tab API to guest scripts.
A remote Linux task uses its remote managed browser or private desktop; it
cannot silently drive local user Chrome.

# Boundaries

Private control recovery after Runtime restart uses the same initial managed
profile preparation as ordinary tools. The private input helper cannot create a
second owner of the default profile; passive sampling never launches resources.

The current invocation supplies exact allowed origins. Document requests,
including frame navigation and redirects, are checked before continuation.
New origins require user authorization. OOP and nested frames are addressed via
their own sessions. Missing frames and stale references do not fall back to the
main document.

A popup is a new target. Native `window.open`, cached openers, targeted links,
forms and WindowProxy results retain browser behavior. The initiating action
may open a window or change focus; Flower does not rewrite page code or replay
a form to force background execution. Popup creation is part of that action's
effect, so a missing acknowledgement is terminal and must not be retried.

The opener returns `target_changed`, `opener_tab_id`, bounded opened-page facts
and `action_executed`. The current batch stops with its confirmed action prefix;
it does not request user input. Flower discovers the actual child through
inventory, explicitly selects it and observes before continuing. References do
not transfer between pages. Full access already permits the new site; other
modes require a grant before Flower inspects or acts on it. Login, CAPTCHA, Stop
and unknown effects retain their existing boundaries. A page's native popup navigation can
load its URL before selection; site grants constrain Flower's controlled target,
not every network request a website can make. This distinction also applies to
ordinary subresources. Cancellation or revoked access before the initiating
action prevents dispatch. Subsequent commands never follow a popup implicitly.

Background execution remains preferred, but native popup and application
behavior may change focus. Task completion takes priority over simultaneous
human use. There is no zero-interference promise for arbitrary external pages.
See the [Codex design evidence](computer-use-design-evidence.md) for the
public and installed-code comparison; no forced reload or CSP rewriting is used.

# Evidence

- `redeven:internal/ai/computer_managed_browser.go` - managed profile and process ownership.
- `redeven:internal/ai/computer_managed_browser_test.go` - login isolation, saved downloads and profile validation.
- `redeven:internal/ai/computer_extension.go` - connection authorization, framing and scoped cancellation.
- `redeven:browser-extension/background.mjs` - exact-tab debugger binding and connection lifetime.
- `redeven:internal/envapp/ui_src/scripts/computerBrowserController.mjs` - shared action, privacy and result path.
- `redeven:internal/envapp/ui_src/scripts/computerBrowserSource.mjs` - one managed/CDP source and shared debugger lifecycle.
- `redeven:internal/envapp/ui_src/scripts/computerBrowserSource.node-test.mjs` - projection disposal and repeated cross-process frame retirement.
- `redeven:internal/envapp/ui_src/scripts/computerBrowser.node-test.mjs` - real frames, input, downloads and navigation.
- `redeven:internal/envapp/ui_src/scripts/computerNativeMessaging.node-test.mjs` - real Chrome native-host launch.
- `redeven:internal/envapp/ui_src/scripts/computerExtension.node-test.mjs` - extension actions, background editing and unbound popup targets.
- `redeven:internal/envapp/ui_src/scripts/computerPopup.node-test.mjs` - native forms, WindowProxy, cached openers, target authority and unknown effects.
