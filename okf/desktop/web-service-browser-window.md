---
type: Runtime Contract
title: Desktop Web Service browser window
tags: [desktop, managed-services, security, ui]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Desktop owns protected target views, toolbar, navigation and cleanup over Runtime-authorized Web Service routes. Invalid navigation rejects, while marked upstream failure offers local retry without reauthorizing or restarting the app. When the trusted Desktop Shell bridge is present, Env App requests a semantic Web Service window instead of creating a renderer popup.

# Contract

The address field always projects the protected route back onto the user's original service origin and current application path; it must not expose Runtime listener ports, private hostnames, `/pf/<id>` prefixes, forward identities, boot routes, entry tickets, or other transport details.

[Managed opening](../architecture/managed-web-service-opening.md) owns the response and first-navigation boundary.

A Runtime-rejected reserved path keeps HTTP 404 and carries
`X-Redeven-Proxy-Error: port-forward-reserved-path`. The browser presentation
replaces only a marked main-document response with a localized, scriptless
explanation using published Floe window-status assets. The initial view shows a
short title without a primary action. A native, initially collapsed View details disclosure
reveals the reason, original service address with its current path, query and
fragment, and Copy address. It does not suggest retries or direct access. The toolbar
remains the sole address editor. Copy uses the host-projected address and acknowledges
completion in place. Only the exact current host document can request this action.
Theme/language refresh retains the explanation; navigating
to another address restores ordinary browsing. System-browser opening is disabled
on this page because the same protected route would reject it again.

Runtime strips its proxy-error header from application responses. Unmarked
application 404s and marked subresource responses never replace the document.
Env UI/API isolation and the saved access mode remain unchanged. This does not
add nested Env access or an automatic loopback fallback.

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

- `redeven:desktop/src/shared/desktopShellWebServiceWindowIPC.ts:1` - Source.
- `redeven:desktop/scripts/check-web-service-reserved-path.mjs` - Collapsed and expanded native rendering across published themes, four locales and two widths, keyboard disclosure, address copying, redirect handling and ordinary application 404 preservation.
