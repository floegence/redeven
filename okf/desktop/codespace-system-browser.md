---
type: Runtime Contract
title: CodeSpace system-browser access
description: Open a CodeSpace in an ordinary system browser through the selected Desktop environment route without exposing private bridge credentials.
tags: [desktop, codespace, security, browser]
timestamp: 2026-09-09T00:00:00Z
---
# Summary

Desktop owns CodeSpace system-browser admission and listener lifetime. The trusted environment root sends a resource ID; main resolves the existing environment transport and opens a short-lived entry on an isolated loopback hostname. An ordinary browser exchanges that entry for a resource-bound session and uses native HTTP and WebSockets. Runtime remains the authority for permissions, AccessGate, and the running editor generation through the [native CodeSpace contract](codespace-native-access.md). The private bridge token never enters the browser. Closing the environment ends its browser routes; opening errors leave no newly authorized listener behind.

# Contract

## Resource intent and route ownership

After starting the selected CodeSpace, Env App submits `mode: browser` and its CodeSpace ID through the same root-frame-only IPC used for built-in editor windows. An ephemeral password may unlock the separately authorized remote Code App session. Renderer-provided URLs, hosts, ports, and routes are rejected. The generic external-URL action does not own CodeSpace opening.

Both Desktop targets use one main-process route selector. Native and placement access retain the existing private bridge; Gateway, explicit external Local UI, and remote environments retain their selected native route. The system browser never receives a private Local UI `/cs/<id>` URL, an environment credential, or a raw gateway header. Browser-only Env App opening outside Desktop keeps its existing Local UI or trusted launcher flow.

System-browser sessions have an independent owner under the environment, so closing a built-in editor window does not close browser tabs. Their profile derives from the same environment/account/resource identity with a separate browser namespace. The existing profile store records a stable listener port. The presentation hostname is `cs-<40 hexadecimal profile characters>.localhost`, with an exact Host and port check on a listener bound only to `127.0.0.1`. Each resource therefore has a separate cookie hostname as well as an origin. Runtime accepts only this shaped loopback origin or the built-in numeric-loopback origin as presentation metadata; that metadata never selects an upstream dial target.

## One-time entry and browser session

Only main can mint an entry from the gateway object. One pending 256-bit entry per gateway expires after 60 seconds; minting replaces the prior pending entry. The reserved entry endpoint consumes the pending entry on its first exact-Host redemption attempt and requires GET with the exact path and query. It forwards no entry request to Runtime. Success sets a Host-only, HttpOnly, SameSite=Strict cookie and sends a non-cacheable 303 to `/` with `Referrer-Policy: no-referrer`. The bound Runtime then supplies the workspace redirect. The entry is removed before editor documents or scripts load.

Browser admission requires exactly one matching cookie, the exact listener authority, and the active gateway. Cross-site Fetch Metadata and a supplied foreign Origin are rejected. Unsafe methods and WebSocket upgrades require the exact presentation Origin. Browser-mode listeners do not accept the built-in editor header as an alternate credential. Runtime and editor traffic never carries the browser cookie; upstream responses cannot set the reserved cookie name. Normal editor cookies, bodies, resource paths and WebSocket frames retain their native forwarding semantics.

The session lasts at most 12 hours from gateway creation. Its timer closes the listener and all owned connections, not just future request admission. Entries and credentials remain process-local. A new explicit browser opening closes the previous route for that resource and acquires the current editor generation on the same saved origin, allowing recovery after a stopped/restarted CodeSpace. Concurrent openings for that resource share setup. Other CodeSpaces and built-in windows remain independent. Closing the environment aborts pending setup and closes every browser route; late route acquisition cannot open a browser. An OS-open failure closes the newly acquired gateway and route.

# Boundaries

The browser cookie grants only the bound native editor, never Local UI management, a sibling CodeSpace, an environment session, or a Web Service. Existing Runtime generation, permission, access expiry and revocation checks remain authoritative. Desktop is required while these browser tabs are in use. After environment closure or session expiry, the user reopens the CodeSpace from Desktop.

Compatibility epoch 14 fences out Runtime implementations that accept only the epoch 13 numeric presentation origin. The compatibility manifest retains every reviewed prior upgrade and the storage-generation fence. No upstream package, public listener, SSH forwarding process, editor injection, or Web Service authorization change is required.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.tsx` - Desktop browser selection submits resource intent after startup.
- `redeven:desktop/src/main/main.ts` - Trusted sender, shared route selector, and environment-owned disposal.
- `redeven:desktop/src/main/codespaceBrowserSessions.ts` - Profile identity, concurrent setup, explicit reopen, and failure cleanup.
- `redeven:desktop/src/main/codespaceBrowserAuthorization.ts` - Bounded entry, strict browser credential, and request-origin admission.
- `redeven:desktop/src/main/codespaceNativeGateway.ts` - Shared forwarding, cookie isolation, and active-connection expiry.
- `redeven:internal/codeapp/appserver/native_origin.go` - Shared Local UI and remote presentation-origin validation.
- `redeven:desktop/src/main/codespaceBrowserGateway.test.ts` - Real HTTP/upgrade admission, cookie stripping, replay, expiry and Host isolation.
- `redeven:desktop/src/main/codespaceBrowserSessions.test.ts` - Reopen, independent resources, OS failure and setup/disposal races.
- `redeven:desktop/scripts/check-codespace-system-browser.mjs` - Opt-in real Chrome with a fresh profile, real private bridge, managed code-server, workspace with spaces, file save, terminal execution, reload and denial checks. Requires built embedded assets, installed UI/ Desktop dependencies and an explicit code-server binary; it does not certify a deployed SSH or control-plane service.
