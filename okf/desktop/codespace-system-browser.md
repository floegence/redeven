---
type: Runtime Contract
title: CodeSpace system-browser access
tags: [desktop, codespace, security, browser]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Desktop resolves trusted resource identity over Environment transport into short-lived loopback entry. The system browser never receives a private Local UI `/cs/<id>` URL, an environment credential, or a raw gateway header. Runtime accepts only this shaped loopback origin or the built-in numeric-loopback origin as presentation metadata; that metadata never selects an upstream dial target.

# Contract

## Resource intent and route ownership
After starting the selected CodeSpace, Env App submits `mode: browser` and its CodeSpace ID through the same root-frame-only IPC used for built-in editor windows.

## One-time entry and browser session
Only main can mint an entry from the gateway object.

Runtime and editor traffic never carries the browser cookie; upstream responses cannot set the reserved cookie name.

An OS-open failure closes the newly acquired gateway and route.

# Boundaries

The browser cookie grants only the bound native editor, never Local UI management, a sibling CodeSpace, an environment session, or a Web Service.

No upstream package, public listener, SSH forwarding process, editor injection, or Web Service authorization change is required.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.tsx` - Source.
