---
type: Architecture Contract
title: Remote browser surface
description: Mount shared browser windows with current control and coherent tab presentation.
tags: [architecture, browser, ui]
timestamp: 2026-09-23T00:00:00Z
---
# Summary

- Authority: the environment window owns its authenticated Session and private control token; FloeBrowser owns reusable browser chrome and inert page presentation.
- Outcome: Desktop and Web clients browse through the same surface and can open independent windows without selecting their source again.
- Invariants: fresh source selection and control admission precede input; child windows receive only named browser operations; cached documents confer no authority.
- Failure boundary: replacing a source fails without destroying the current view; disconnect destroys stale presentation and never replays uncertain input.

# Window ownership

The shared `FloeBrowserSurface` mounts the released `@floegence/floebrowser` viewer against a Runtime-issued authenticated projection endpoint. Its endpoint is an opaque carrier identity. The viewer can request takeover, but the host decides whether control is granted and revokes it before draining in-flight input. A disconnected or stale generation destroys the previous view before mounting a new one, so old DOM and notices cannot flash over a new tab.

Source admission, popup privacy and directory retirement belong to [browser source ownership](remote-browser-sources.md). [Browser persistence](remote-browser-persistence.md) owns the library and managed restoration. [Browser transport and media](remote-browser-media.md) owns authenticated carriers and source playback.


The Browser page opens the default managed profile without AI configuration.
The environment shell loads the window adapter only when a browser window is
requested. The full viewer engine belongs to the browser document, outside the
environment and access documents' initial asset graphs. Locale keys come from
the maintained product catalog and are checked against the released engine.
Its source dialog edits a draft and applies it only on Open; profile creation,
Chrome setup and browser installation reuse the same operations as Flower.
Independent windows reuse the admitted source identity, so reopening a window
never repeats a new-tab operation or rebinds an outdated URL selection. They mount
the same source chooser through named product-port operations. Installation uses
the environment's existing coordinator, including Desktop package transfer;
the child receives no generic fetch, IPC, installation-chunk or Session API.
A failed replacement leaves the current window and source usable. External
popups remain outside its grants until the user explicitly selects that page.

The environment window forwards input readiness only after both the private
control token and the matching source control grant arrive. Revocation and tab
changes remain immediate; a delayed token cannot revive a revoked grant.
Address submissions additionally wait for idle-control admission. HTTP responses and DOM/control messages may
arrive in either order. A changed tab, newer address or disconnected view cancels
an unsubmitted navigation; previously submitted input is never retried.


# Tab presentation

The viewer keeps at most three complete inert tab documents for immediate visual
feedback. Cached presentation grants no input: only fresh source selection,
control admission and a complete current document enable page interaction.
Background URL changes, removed directory grants and disconnect evict caches.
Only browsers with state-preserving DOM moves retain iframe documents; other
engines rebuild without claiming a cached-display latency result.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FloeBrowserSurface.tsx` - Shared viewer mount and generation-bound cleanup.
- `redeven:internal/envapp/ui_src/src/ui/services/browserWindow.ts` - Environment-owned window, source replacement and private control admission.
- `redeven:internal/envapp/ui_src/src/ui/services/browserWindow.test.ts` - Grant/token ordering, immediate revocation and stale selection rejection.
- `floebrowser:src/viewer/replay-pages.ts` - Bounded inert document retention.
- `floebrowser:test/tab-cache.e2e.ts` - Immediate presentation without stale input authority.
