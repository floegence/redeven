---
type: Architecture Contract
title: Remote browser surface
description: Mount shared browser windows with source selection, theme and authenticated window lifetimes.
tags: [architecture, browser, ui]
timestamp: 2026-09-27T00:00:00Z
---
# Summary

- Authority: the environment window owns its authenticated Session and private control token; FloeBrowser owns reusable browser chrome and inert page presentation.
- Outcome: Desktop and Web clients browse through the same surface and can open independent windows without selecting their source again.
- Invariants: fresh source selection and control admission precede input; child windows receive only named browser operations; cached documents confer no authority.
- Failure boundary: replacing a source fails without destroying the current view; disconnect destroys stale presentation and never replays uncertain input.

# Contract

Embedded and independent views receive the Shell's admitted Session only after
the existing local readiness handshake. Transport establishment alone does not
authorize initial source reads. This prevents an early request from racing the
Runtime's product-session registration without introducing retries.

## Window ownership

The shared `FloeBrowserSurface` mounts the released `@floegence/floebrowser` viewer against a Runtime-issued authenticated projection endpoint. Its endpoint is an opaque carrier identity. The viewer can request takeover, but the host decides whether control is granted and revokes it before draining in-flight input. A disconnected or stale generation destroys the previous view before mounting a new one, so old DOM and notices cannot flash over a new tab.

Source admission, popup privacy and directory retirement belong to [browser source ownership](remote-browser-sources.md). [Browser persistence](remote-browser-persistence.md) owns the library and managed restoration. [Browser transport and media](remote-browser-media.md) owns authenticated carriers and source playback.


The Browser page first offers two source cards: the personal browser is recommended
and the built-in browser remains independent. It does not force a managed profile.
The chooser reveals connection setup, page selection and profile administration
only after the corresponding source is chosen. Profile creation is disclosed on
request; advanced debugging endpoints occupy a secondary step. Each step shows
only its applicable actions, with one concise body description and local errors.
Source cards keep their action labels on one line and associate separate, wrapping
descriptions through accessible description references. The whole card remains
one pointer target; narrow layouts must keep both cards and their explanatory
text inside the dialog rather than hiding overflow.
Successful source preferences follow the [persistence contract](remote-browser-persistence.md).
A missing or invalid preference returns to selection without starting a browser.
First use is a neutral selection state, including after the chooser is dismissed;
only a previously remembered or selected source can be reported as unavailable.
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
personal-browser setup and browser installation reuse the same operations as Flower.
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
Carrier failure, status and tab callbacks must belong to both the current
window host and the controller's committed view. Desktop document admission is
asynchronous, so the previous host can remain mounted briefly after its view
has been released; its late events have no authority over the replacement.
Reconnection uses a confirmed source, never an earlier new-tab operation. Theme
configuration refreshes with unchanged effective values do not reopen a view.
Actual locale or palette changes acquire a new view of the selected target;
callbacks from the retired document cannot change current presentation.
The trusted document captures real pointer input from browser chrome, recovery
controls and the released engine's input surface above its inert replay iframe.
It sends a payload-free interaction notification over the existing private
product port. Only the current document may notify its placement owner; closing
or replacing it retires that callback. This local notification is independent
of source control and remains available during recovery. The Activity Browser
page uses it to dismiss the [Flower companion](../ui/flower-activity-companion.md)
without preventing the destination click, synthesizing input or moving focus.
Programmatic focus, state messages and ordinary window messages do not trigger
this route; independent browser windows have no companion-placement callback.

One product theme adapter captures the parent's resolved design-system token
catalog, effective dark mode, surface style, shell preset and font family. The
trusted browser document applies that presentation before mounting recovery or
source dialogs. Engine chrome derives its palette and primary-button foreground from those same
semantic tokens and uses the captured font. FloeBrowser uses only namespaced CSS
properties, preserving host background and text token meanings across tab bars,
libraries, menus, media controls and navigation errors. The child has no separate theme provider, stored preference or
reverse palette aliases; light and dark dialogs, buttons and fields must match
the environment in both embedded and independent windows.

Availability checks and document connections use the shared Terminal-style
loading curtain: a centered localized surface label, slim animated indicator and
status text within the browser content area. Embedded and independent documents
load the same curtain styles, follow the host palette and honor reduced motion.
Loading never takes the place of actionable installation or recovery content.

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
Parent destruction or navigation retires reservations and static-document grants
before closing child windows. Cleanup detaches from the captured WebContents
event emitter without reading an already destroyed BrowserWindow; repeated
teardown and previously closed children remain harmless.
Desktop presents the independent window at creation. Its visible shell owns
loading and recovery; a paint event must not gate the user's window visibility.
For a Desktop private Local UI bridge, the main process lends authentication
headers only to that child's reserved static document and same-origin Env App
assets. The child is not registered as an environment or IPC owner; API paths,
other origins, other document instances and non-GET requests receive no grant.

# Boundaries

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
globe icon; Remote Browser uses a purpose-drawn navigation compass: a single
round bezel and a split-tone diagonal needle remain legible at the 24 px dock
size. All shapes inherit the navigation color in both themes and all interaction
states; the icon is decorative and the owning control supplies its localized name.

The source chooser owns its draft and pending selection until explicit dismissal
or successful document replacement. Opening and failure updates from a retired
view must not unmount the chooser and cancel its replacement request. Candidate
failures remain visible within the chooser; closing it still cancels its intent.

Presentation and input readiness follow the canonical
[remote browser presentation contract](remote-browser-presentation.md), including
tab geometry, inert previews, control admission, navigation fences and source-owned
website verification. Window adapters consume those released capabilities.

# Evidence

- `redeven:internal/envapp/ui_src/src/browserDocument.test.ts` - Source selection survives retired-view progress and failure without canceling its intent.

- `redeven:internal/envapp/ui_src/src/browserDocument.browser.test.tsx` - Real document handshake, native pointer dismissal through the private host port, and dialog/control theme parity in light/dark and narrow layouts.
- [FloeBrowser v0.1.16: test/chrome-theme.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.16/test/chrome-theme.e2e.ts) — Host token preservation and readable chrome controls in both themes.
- `redeven:internal/envapp/ui_src/src/ui/services/browserDocumentTheme.ts` - Single parent-to-document presentation adapter.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FloeBrowserSurface.tsx` - Shared viewer mount and generation-bound cleanup.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FloeBrowserSurface.test.tsx` - Source-selection progress retains the current document until replacement.
- `redeven:internal/envapp/ui_src/scripts/checkBrowserProjection.mjs` - Real component, Session and Runtime profile switching in inline and independent documents.
- `redeven:internal/envapp/ui_src/src/ui/services/browserWorkspaceController.ts` - Single view intent and release owner.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvBrowserPage.test.tsx` - Effective presentation changes without repeated source opens.
- `redeven:internal/envapp/ui_src/src/ui/services/browserWorkspaceWindows.test.ts` - Retained window shells and independent cleanup.
- `redeven:desktop/src/main/browserProjectionWindows.test.ts` - Exact static-document loading without environment API authority and idempotent cleanup after parent destruction.
- `redeven:internal/envapp/ui_src/src/ui/services/browserWindow.ts` - Environment-owned window, source replacement and private control admission.

- [FloeBrowser v0.1.13: test/browser-menu.e2e.ts](https://github.com/floegence/floebrowser/blob/v0.1.13/test/browser-menu.e2e.ts) — Address-row actions, activation, focus, narrow bounds and late completion.
