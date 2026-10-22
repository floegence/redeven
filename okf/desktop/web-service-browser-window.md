---
type: Runtime Contract
title: Desktop Web Service browser window
description: Present trusted browser chrome around an isolated authorized application view without exposing transport details.
tags: [desktop, managed-services, security, ui]
timestamp: 2026-09-22T02:30:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop owns the trusted toolbar, isolated target view, navigation admission, and window cleanup. The Runtime's [Web Service session contract](../architecture/web-service-browser-sessions.md) owns the forward identity and authorized route. Reopening the same live forward reuses its window; application content never receives a Desktop bridge. Invalid navigation fails closed, while a marked upstream connection failure exposes a local retry without replacing authorization or restarting the application.

# Contract

When the trusted Desktop Shell bridge is present, Env App requests a semantic Web Service window instead of creating a renderer popup. The address field always projects the protected route back onto the user's original service origin and current application path; it must not expose Runtime listener ports, private hostnames, `/pf/<id>` prefixes, forward identities, boot routes, entry tickets, or other transport details.

[Managed opening](../architecture/managed-web-service-opening.md) owns the response and first-navigation boundary.

The semantic forward-window request optionally selects `presentation: application`. The same forward admission, isolated partition, request routing, window reuse, and teardown remain authoritative.

The [application titlebar contract](host-application-titlebar.md) owns control layout, backend command routing and recovery presentation.

# Boundaries

Desktop isolation is a B-level browsing surface over Redeven's existing authorized route; it is not Remote Browser Isolation and does not claim a general-purpose browser security boundary. Redeven must not label a same-page iframe as complete isolated browsing, copy a reusable RBI implementation into this repository, or bypass the published-dependency policy to obtain one.

System-browser authorization and the persisted access-mode decision remain owned by the session contract; a window cannot create a new route or broaden a forward identity.

# Evidence

- `redeven:desktop/src/shared/desktopShellWebServiceWindowIPC.ts:1` - The semantic Desktop IPC validates HTTP(S) URLs and DNS-safe forward identities.

- `redeven:desktop/src/main/navigation.ts:256` - Desktop recognizes the exact private Web Service route and projects it as the target address.

- `redeven:desktop/src/main/webServiceLoopbackGateway.ts` - The isolated gateway maps redirects for the current protected Forward back to application-root paths without accepting other route identities.
