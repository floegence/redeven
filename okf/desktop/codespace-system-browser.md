---
type: Runtime Contract
title: CodeSpace system-browser access
description: Open a CodeSpace in an ordinary system browser through the selected Desktop environment route without exposing private bridge credentials.
tags: [desktop, codespace, security, browser]
timestamp: 2026-09-09T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop resolves a trusted resource ID through the environment transport and opens an isolated short-lived loopback entry. Browser exchanges it for resource-bound HTTP/WS sessions; private bridge tokens never enter it. Runtime owns permissions, AccessGate and editor generation. Environment closure ends routes; failed open leaves no new authorized listener.

# Contract

## Resource intent and route ownership
After starting the selected CodeSpace, Env App submits `mode: browser` and its CodeSpace ID through the same root-frame-only IPC used for built-in editor windows.

The system browser never receives a private Local UI `/cs/<id>` URL, an environment credential, or a raw gateway header.

Runtime accepts only this shaped loopback origin or the built-in numeric-loopback origin as presentation metadata; that metadata never selects an upstream dial target.

## One-time entry and browser session
Only main can mint an entry from the gateway object.

Runtime and editor traffic never carries the browser cookie; upstream responses cannot set the reserved cookie name.

An OS-open failure closes the newly acquired gateway and route.

# Boundaries

The browser cookie grants only the bound native editor, never Local UI management, a sibling CodeSpace, an environment session, or a Web Service.

No upstream package, public listener, SSH forwarding process, editor injection, or Web Service authorization change is required.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.tsx` - Desktop browser selection submits resource intent after startup.

- `redeven:desktop/src/main/codespaceBrowserSessions.ts` - Profile identity, concurrent setup, explicit reopen, and failure cleanup.
