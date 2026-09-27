---
type: Architecture Contract
title: Separate remote browser preparation
description: Prepare a persistent browser profile without taking over a personal profile or creating a second application lifecycle.
tags: [architecture, browser, applications]
timestamp: 2026-09-27T00:00:00Z
---
# Summary

- Authority: Runtime resolves the browser installation and owns its Native Messaging registration; Host Applications owns the prepared application identity and its process/display lifecycle.
- Outcome: explicit preparation creates a persistent, separate Linux browser profile and a fixed application entry. Preparation does not launch a browser or establish a connection.
- Invariants: clients cannot choose executable paths, profile directories, launch arguments or graphical backends. Existing personal browser databases remain untouched.
- Failure boundary: unsupported platforms, absent installations, invalid registration or non-private profile directories fail before launch. Preparation is not evidence that a graphical backend can execute the application.

# Contract

The authenticated `POST /_redeven_proxy/api/browser/extension/remote` operation
requires read, write and execute authority. It accepts only an installation ID
from Runtime discovery. Runtime prepares the existing extension registration,
then Host Applications prepares the profile and returns its application entry.
The operation neither acquires an AI provider nor creates website grants.

Application identity derives from Runtime state, the authenticated owner and the
installation ID. Repeated preparation preserves browser cookies, site storage
and extension consent. Native Chrome and Chromium profiles live in private
Runtime state. Snap Chromium profiles live in its allowed user-data area.
Preparation rejects linked profile directories and directories accessible to
other operating-system users. This is process and launch ownership within the
Runtime OS account, not a new OS-user isolation boundary.

Prepared application entries are visible and launchable only through their
preparing Runtime owner's Host Applications catalog. Ordinary application
discovery is unchanged. The existing Host Applications launch, preparation,
viewer and recovery path remains the sole lifecycle owner. Browser preparation
must not force an unsupported graphical backend, inject the desktop session
bus, disable the browser sandbox or add another display/input implementation.

Only Native Messaging registration is linked into the separate browser profile.
Its validated canonical manifest remains owned by Runtime, so an atomic
registration replacement after Runtime restart reaches already prepared
profiles without retaining retired socket paths. Runtime shutdown removes that
registration; it does not delete browser data. No personal browser profile,
Cookie database or site storage is copied or shared with a second process.

First extension installation and Connect remain explicit browser operations.
Preparing an application does not prove a handshake or grant a tab to Flower.
The [source admission contract](remote-browser-sources.md) continues to own
Native Messaging, tab selection, grants and private descendants.

# Product handoff

The shared connection guide offers separate-profile preparation on Linux when
its carrier can navigate to Host Applications. When the existing desktop is
unavailable, separate preparation is the primary action and desktop-only
instructions remain behind an explicit secondary action. Preparation failures
stay beside that action; they do not report a successful browser connection.

Embedded browser, independent browser document and environment Flower all use
one preparation adapter. The independent document may submit only an opaque
installation ID through its existing message port. It receives no generic
application launch, filesystem or Desktop capability. Closing the guide aborts
the handoff; a late response cannot navigate the user away from their new view.

The environment carries one transient application reveal request. The active
Host Applications page refreshes its authenticated catalog before showing the
application identity and the existing preparation consent or Open action.
Revealing an application does not launch it, start a component download or open
an unrequested popup. Runtime/session changes invalidate an unfinished reveal.
The next explicit click owns normal launch and popup reservation. Browser
selection and Flower control still require the existing connection handshake
and source-selection flow.

# Evidence

- `redeven:internal/codeapp/appserver/browser_workspace_api.go` - Authenticated preparation with fixed installation identity.
- `redeven:internal/codeapp/appserver/browser_workspace_api_test.go` - Missing authority and caller-selected path rejection.
- `redeven:internal/browserbridge/remote_profile.go` - Stable profile placement and canonical registration reference.
- `redeven:internal/browserbridge/remote_profile_test.go` - Data preservation, Runtime replacement and unsafe directory rejection.
- `redeven:internal/hostapps/browser.go` - Fixed application preparation and owner-specific catalog admission.
- `redeven:internal/hostapps/browser_test.go` - Cross-owner application identity rejection.
- `redeven:internal/flower_ui/host/remoteBrowserPreparation.ts` - Shared preparation and cancellation-aware handoff.
- `redeven:internal/envapp/ui_src/src/ui/FlowerComputerConnections.browser.test.tsx` - Explicit setup, honest connection state and closed-guide cancellation.
- `redeven:internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.test.tsx` - Catalog-scoped reveal, preparation consent and explicit launch.
