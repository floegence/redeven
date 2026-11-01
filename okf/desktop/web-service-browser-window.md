---
type: Runtime Contract
title: Desktop Web Service browser window
tags: [desktop, managed-services, security, ui]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Desktop owns protected target views, toolbar, navigation and cleanup over Runtime-authorized Web Service routes. Reopen reuses the same live forward; content gets no Desktop bridge. Invalid navigation rejects, while marked upstream failure offers local retry without reauthorizing or restarting the app.

# Contract

When the trusted Desktop Shell bridge is present, Env App requests a semantic Web Service window instead of creating a renderer popup. The address field always projects the protected route back onto the user's original service origin and current application path; it must not expose Runtime listener ports, private hostnames, `/pf/<id>` prefixes, forward identities, boot routes, entry tickets, or other transport details.

[Managed opening](../architecture/managed-web-service-opening.md) owns the response and first-navigation boundary.

The semantic forward-window request optionally selects `presentation: application`. The same forward admission, isolated partition, request routing, window reuse, and teardown remain authoritative.

The [application titlebar contract](host-application-titlebar.md) owns control layout, backend command routing and recovery presentation.

Electron qualification checks that the compound address boundary has no visible
outline by asserting `outline-style: none`, alongside stable border width and
focus contrast across every published theme. Chromium may report a nonzero
computed outline width even when that outline is disabled.

# Boundaries

Desktop isolation is a B-level browsing surface over Redeven's existing authorized route; it is not Remote Browser Isolation and does not claim a general-purpose browser security boundary. Redeven must not label a same-page iframe as complete isolated browsing, copy a reusable RBI implementation into this repository, or bypass the published-dependency policy to obtain one.

System-browser authorization and the persisted access-mode decision remain owned by the session contract; a window cannot create a new route or broaden a forward identity.

# Evidence

- `redeven:desktop/src/shared/desktopShellWebServiceWindowIPC.ts:1` - Semantic IPC validates HTTP(S) and DNS-safe forward IDs.

- `redeven:desktop/src/main/webServiceLoopbackGateway.ts` - Protected Forward redirects stay in the same route identity.
