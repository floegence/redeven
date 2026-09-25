---
type: Architecture Contract
title: Remote browser surface
description: Mount shared browser windows with current control and coherent tab presentation.
tags: [architecture, browser, ui]
timestamp: 2026-09-25T00:00:00Z
---
# Summary

- Authority: the environment window owns its authenticated Session and private control token; FloeBrowser owns reusable browser chrome and inert page presentation.
- Outcome: Desktop and Web clients browse through the same surface and can open independent windows without selecting their source again.
- Invariants: fresh source selection and control admission precede input; child windows receive only named browser operations; cached documents confer no authority.
- Failure boundary: replacing a source fails without destroying the current view; disconnect destroys stale presentation and never replays uncertain input.

# Contract

## Window ownership

The shared `FloeBrowserSurface` mounts the released `@floegence/floebrowser` viewer against a Runtime-issued authenticated projection endpoint. Its endpoint is an opaque carrier identity. The viewer can request takeover, but the host decides whether control is granted and revokes it before draining in-flight input. A disconnected or stale generation destroys the previous view before mounting a new one, so old DOM and notices cannot flash over a new tab.

Source admission, popup privacy and directory retirement belong to [browser source ownership](remote-browser-sources.md). [Browser persistence](remote-browser-persistence.md) owns the library and managed restoration. [Browser transport and media](remote-browser-media.md) owns authenticated carriers and source playback.


The Browser page prepares the default managed profile without AI configuration.
One browser workspace controller owns source choice, open intent, replacement,
view release and recovery for both the page and independent windows. Surfaces
own only their document and ports. Managed opens check current installation
readiness before admission; Runtime checks again at process launch. Browsing
never initiates an installation without confirmation.
The environment shell loads the window adapter only when a browser window is
requested. The full viewer engine belongs to the browser document, outside the
environment and access documents' initial asset graphs. Locale keys come from
the maintained product catalog and are checked against the released engine.
The address row's More menu owns product actions. Both inline and independent
windows expose source selection and open independent windows there through
named host operations. There is no separate product toolbar.
The menu shows the current source as secondary text, preserves keyboard focus,
and renders localized failures without changing the selected page. Hosts supply
plain labels and callbacks to the released FloeBrowser menu; they do not copy its
chrome or menu implementation.
Its source dialog edits a draft and applies it only on Open; profile creation,
Chrome setup and browser installation reuse the same operations as Flower.
Independent windows reuse the admitted source identity, so reopening a window
never repeats a new-tab operation or rebinds an outdated URL selection. They mount
the same source chooser through named product-port operations. Installation uses
the environment's existing coordinator, including Desktop package transfer;
the child receives no generic fetch, IPC, installation-chunk or Session API.
A failed replacement leaves the current window and source usable. External
popups remain outside its grants until the user explicitly selects that page.

Each controller keeps one current open intent. Late results can only release
their own view; they cannot replace a newer choice. A Session interruption
revokes the old view and ports while preserving the independent window shell.
Progress notifications with the same view and Session retain the current
document and its in-flight source-selection request. A committed replacement
changes the document exactly once; retiring the old document cannot cancel or
restore a preceding selection after that commit.
Reconnection uses a confirmed source, never an earlier new-tab operation. Theme
configuration refreshes with unchanged effective values do not reopen a view.
Actual locale or palette changes acquire a new view of the selected target;
callbacks from the retired document cannot change current presentation.

Structured error codes select installation, enablement, source selection,
reconnection or explicit [service recovery](remote-browser-recovery.md).
The source chooser preserves its draft and displays replacement errors locally.
Its installation step has no redundant disabled Open action. Installation and
continuation follow the shared [installation contract](../ai/computer-use-browser-installation.md).

The trusted document is a static shell without a view identity or source data.
Its URL carries only a fresh instance nonce, also checked against the exact
opener or parent before handing over ports. A source replacement changes the
query as well as the nonce, so the browser loads a new document instead of doing
a fragment-only navigation with retired ports. Desktop reserves that exact URL
once and gives the child no preload or generic bridge.
Desktop presents the independent window at creation. Its visible shell owns
loading and recovery; a paint event must not gate the user's window visibility.
For a Desktop private Local UI bridge, the main process lends authentication
headers only to that child's reserved static document and same-origin Env App
assets. The child is not registered as an environment or IPC owner; API paths,
other origins, other document instances and non-GET requests receive no grant.

View creation, source management, control, preferences, library, resource reads,
downloads and cleanup use the Shell's existing Session HTTP lifecycle. Local UI
cookies and the synthetic `local-ui` HTTP identity never own a browser view.
DOM, input, media and upload lanes borrow that same Session. Runtime owner and
channel checks remain mandatory; no local-identity fallback exists. Source
resources and downloads are named operations on the existing product port,
scoped to its issued view. The document cannot choose another view, a URL, or
request headers. This works without a Service Worker on direct Local UI clients.

Selecting the current source explicitly opens a fresh view, including after
browser installation or a failed initial open. Browser chrome consumes the host
palette in welcome, navigation and disconnected states. Web Services retains its
globe icon; Remote Browser uses a rounded browser-window outline with a compact
outward arrow, with consistent current-color styling in both themes.

The source chooser owns its draft and pending selection until explicit dismissal
or successful document replacement. Opening and failure updates from a retired
view must not unmount the chooser and cancel its replacement request. Candidate
failures remain visible within the chooser; closing it still cancels its intent.

The environment window forwards input readiness only after both the private
control token and the matching source control grant arrive. Revocation and tab
changes remain immediate; a delayed token cannot revive a revoked grant.
Address submissions additionally wait for idle-control admission. HTTP responses and DOM/control messages may
arrive in either order. A changed tab, newer address or disconnected view cancels
an unsubmitted navigation; previously submitted input is never retried.

The released viewer suspends page gestures from explicit navigation intent through
control admission and source completion. It discards unsent input and reports
readiness only when input can resume. A canceled before-unload decision restores
the original page; late completion cannot release a newer navigation's input
fence. Browser chrome, stop and dialog replies remain available throughout.
Repeated clicks on an already focused text field receive a fresh source focus
confirmation and restore the visible native caret without replaying a click.
Chrome and Electron product qualification exercises this behavior through the
same authorized Flowersec Session, including Unicode text insertion.

## Tab presentation

The viewer keeps at most three complete inert tab documents for immediate visual
feedback. Cached presentation grants no input: only fresh source selection,
control admission and a complete current document enable page interaction.
Background URL changes, removed directory grants and disconnect evict caches.
Only browsers with state-preserving DOM moves retain iframe documents; other
engines rebuild without claiming a cached-display latency result.

# Boundaries

The source-page replay remains scriptless. Only the trusted browser chrome
executes locally, through the environment owner's named capabilities. The
address field's Enter key and Go button issue source commands directly, never
a native form submission. Source profile creation and endpoint discovery use
explicit click/Enter handlers for the same reason; composition Enter never
submits. The inline document keeps its restrictive sandbox
without `allow-forms` and its `form-action 'none'` policy.

# Evidence

- `redeven:internal/envapp/ui_src/src/browserDocument.test.ts` - Source selection survives retired-view progress and failure without canceling its intent.
- [FloeBrowser v0.1.14: test/input-focus.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.14/test/input-focus.e2e.ts) — Repeated source focus and native caret continuity.
- [FloeBrowser v0.1.14: test/navigation-input.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.14/test/navigation-input.e2e.ts) — Input fencing through navigation admission and completion.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FloeBrowserSurface.tsx` - Shared viewer mount and generation-bound cleanup.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FloeBrowserSurface.test.tsx` - Source-selection progress retains the current document until replacement.
- `redeven:internal/envapp/ui_src/scripts/checkBrowserProjection.mjs` - Real component, Session and Runtime profile switching in inline and independent documents.
- `redeven:internal/envapp/ui_src/src/ui/services/browserWorkspaceController.ts` - Single view intent and release owner.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvBrowserPage.test.tsx` - Effective presentation changes without repeated source opens.
- `redeven:internal/envapp/ui_src/src/ui/services/browserWorkspaceWindows.test.ts` - Retained window shells and independent cleanup.
- `redeven:desktop/src/main/browserProjectionWindows.test.ts` - Exact static-document loading without environment API authority.
- `redeven:internal/envapp/ui_src/src/ui/services/browserWindow.ts` - Environment-owned window, source replacement and private control admission.
- `redeven:internal/envapp/ui_src/src/ui/services/browserWindow.test.ts` - Grant/token ordering, immediate revocation and stale selection rejection.
- [FloeBrowser v0.1.12: src/viewer/replay-pages.ts](https://github.com/floegence/floebrowser/blob/v0.1.12/src/viewer/replay-pages.ts) — Bounded inert document retention.
- [FloeBrowser v0.1.12: test/tab-cache.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.12/test/tab-cache.e2e.ts) — Immediate presentation without stale input authority.

- [FloeBrowser v0.1.13: test/browser-menu.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.13/test/browser-menu.e2e.ts) — Address-row actions, activation, focus, narrow bounds and late completion.
