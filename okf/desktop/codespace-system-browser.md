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

Desktop owns CodeSpace system-browser admission and listener lifetime. The trusted environment root sends a resource ID; main resolves the existing environment transport and opens a short-lived entry on an isolated loopback hostname. An ordinary browser exchanges that entry for a resource-bound session and uses native HTTP and WebSockets. Runtime remains the authority for permissions, AccessGate, and the running editor generation through the [native CodeSpace contract](codespace-native-access.md). The private bridge token never enters the browser. Closing the environment ends its browser routes; opening errors leave no newly authorized listener behind.

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

- `redeven:desktop/src/main/main.ts` - Trusted sender, shared route selector, and environment-owned disposal.

- `redeven:desktop/src/main/codespaceBrowserSessions.ts` - Profile identity, concurrent setup, explicit reopen, and failure cleanup.
