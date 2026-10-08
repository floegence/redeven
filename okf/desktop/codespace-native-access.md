---
type: Runtime Contract
title: Native Desktop CodeSpace access
description: Bind a Desktop editor origin to one authorized CodeSpace through the current environment transport.
tags: [desktop, codespace, security, transport]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

Desktop owns each built-in CodeSpace window, persistent browser profile, protected loopback listener, and outgoing route. Runtime owns the running editor generation and current permission and access gates. The editor receives normal HTTP and WebSocket traffic without a privileged preload, browser transport injection, or replacement WebSocket implementation. Closing the window, revoking access, or stopping its instance ends the owned connections. An unavailable route or occupied saved port fails that CodeSpace without switching transports or replaying application traffic.

# Contract

## Trusted opening requests

The trusted environment root frame submits `loading` or `open` with a DNS-safe CodeSpace ID. Open carries a one-shot exact-editor delegation issued by the authenticated environment session for remote Code App access. Desktop keeps its exact-scope resume credential only in memory and does not extend the parent lifetime. It accepts no URL, host, port, route, or legacy navigation request. Env App starts the editor first; Desktop resolves the route from the sender's existing EnvironmentSession. Loading is a scriptless local document. [Whole-window status surfaces](../ui/window-status-surfaces.md) owns its shared visual treatment and progress indication.

## Window navigation and recovery

One native-window owner controls the loading document, editor navigation, readiness, and connection resources. Desktop defers automatic window loading and finishes the initial document before acknowledging the loading request or navigating to the editor. Product-triggered document and editor navigations are serialized; pending theme documents are discarded once editor opening starts. Background theme refreshes never present or focus the window. An editor is ready only after its own navigation completes within its bound gateway origin, never merely because a gateway exists or an earlier document emits a completion event.

Concurrent opens share the same pending result. An opening failure releases connection resources and allows explicit retry from Codespaces. Closing cancels and drains the current operation; its late result cannot install request authority, report readiness, or show an error in a replacement window. Late setup completion cannot recreate a closed window, and reopening a ready window only focuses it. Opening-failure diagnostics retain only the CodeSpace ID, transport, bounded stage and error code/number. Page-navigation failures have distinct localized copy from route unavailability; credentials, raw exception messages, and error URLs do not enter these diagnostics.

## Window and profile identity

Each profile hashes the stable environment/resource identity, including control-plane and user identity where present. Gateway session IDs and transport ports are not profile identity. The dedicated persistent Electron partition has no Desktop preload and retains editor storage. `codespace-profiles.json` version 1 records the exact numeric-loopback port through atomic file replacement. Invalid or future state is rejected read-only. An occupied port reports an actionable error; Desktop never contacts its occupant or allocates a replacement origin for that profile.

The first native opening creates a separate browser origin. Existing browser profile data is retained, but cookies, browser-only preferences, and extension sign-ins from the previous origin are not automatically copied. Runtime workspace files, code-server user data, and extension directories remain under their existing owners.

The built-in window listener accepts only exact Host and a random main-process session header. One partition hook removes any renderer-supplied copy and attaches the current capability only to requests whose Chromium frame ancestry or Worker provenance belongs to the editor. Foreign frames cannot inherit authority merely because they request its port. The capability is removed before upstream forwarding. Workers and Service Workers use native browser networking. Navigation leaves the editor origin only through the system browser.

## Selected environment route

Native and placement sessions reuse the current private Local UI bridge and token. Placement consequently retains its existing authenticated H2 `local-ui` surface. Gateway and explicit external Local UI retain their selected listener and TLS validation. Native routing never starts another Runtime, creates an SSH forward, falls back to public Local UI, or changes certificate verification. Runtime access credentials remain in main-process outgoing headers and are stripped before reaching the editor.

Remote environments acquire a fresh Code App entry ticket using the trusted environment session. Published Floe Webapp's isolated artifact source validates the v6 acquisition and exact resource/spend bindings; the published Flowersec Node ConnectionController owns connection attempts and reconnection. No browser runtime capability is fabricated, and no browser boot URL or fragment enters the editor. `code/auth_v1` checks or unlocks the existing channel AccessGate. Env App and Code App resume scopes remain distinct. Passwords are ephemeral and never enter editor storage, URLs, or logs.

## Runtime boundary and HTTP semantics

The Local UI descriptor resolves only an already-running CodeSpace, returns its generation and Runtime-owned `access_cookie_name`, and requires full effective read/write/execute permissions plus the current AccessGate. Desktop queries the returned Cookie name instead of inferring the forwarded port; [Runtime access sessions](../security/runtime-access-sessions.md) owns this authentication contract. Its native route includes that generation. Remote `code/http_v1` runs in the same typed session dispatcher and checks the same full grant and channel gate for every request. Instance and access-session cancellation close in-flight HTTP and upgraded connections.

Both paths use one bound native handler. Its dial target comes only from Runtime's running instance. The handler removes its own `/cs/<id>` prefix at most once, rejects another resource and product management paths, preserves raw query/encoded paths, and retains the managed workspace redirect and VSDA shim. The native Local UI route leaves response policy with the bound editor instead of adding the Local UI shell CSP or frame headers. It neither rewrites editor HTML/CSP nor changes the code-server launch configuration. Desktop system-browser admission and its independent lifetime are defined by [CodeSpace system-browser access](codespace-system-browser.md); both Desktop targets share this bound Runtime handler.

The native gateway streams request/response bodies with backpressure, preserves response cookies, and relays WebSocket upgrades and both buffered heads as opaque bytes. It never retries a submitted request or terminal input. Per-window and per-instance connection admission is bounded at 64; header and dial deadlines are bounded without imposing a short duration on active responses. Published Flowersec owns ByteStream-to-Node-Duplex and Go HTTP stream adaptation; Redeven contains only its resource routing and authorization adapters.

## Compatibility and validation

Compatibility epoch 14 introduced isolated system-browser presentation origins while preserving the epoch 13 HTTP/stream contract and epoch 12 storage-generation fence. The current Desktop/Runtime pair and upgradeable earlier epochs are declared only in the Runtime Service compatibility manifest. The epoch 14 record was qualified against released Flowersec 5.2.2 and Floe Webapp 0.56.2; it is historical compatibility evidence, not the current dependency declaration. The current Redeven pair consumes Flowersec 5.10.5 and Floe Webapp 0.86.5 without sibling source wiring.

# Boundaries

The opt-in Electron fixture exercises the production window owner through loading-document handoff, editor readiness, same-origin redirects, document, Worker, Service Worker and WebSocket requests, and unauthenticated loopback rejection. The real editor fixture uses an explicitly selected installed code-server binary and task-owned state/ports to open a workspace, read and edit a file in Monaco, save it to disk, execute terminal input through a fixture-owned shell profile, and reopen the editor at its saved origin. The native remote fixture uses a real TLS Flowersec Go peer with fixture control-plane acquisition and spend responses to exercise Node session startup, strict target binding, resource-scoped authorization, and binary HTTP. These fixtures do not certify a deployed SSH placement or Redeven Cloud environment. It is separate from ordinary source CI and does not start or stop a user's environment. Focused HTTP tests cover authorization, generation rejection, raw bytes, upgrade heads, cookies, and origin conflicts.

# Evidence

- `redeven:desktop/src/main/codespaceNativeWindows.ts` - Single-window navigation, readiness, cancellation, and bounded failure diagnostics.
- `redeven:desktop/src/main/codespaceNativeWindows.test.ts` - Deterministic document-ordering, retry, concurrent-open, and late-close regression coverage.
- `redeven:desktop/src/shared/desktopShellCodespaceWindowIPC.ts` - ID-only trusted shell request contract.
- `redeven:desktop/src/main/codespaceNativeProfiles.ts` - Persistent origin identity and read-only corruption rejection.
- `redeven:desktop/src/main/codespaceNativeSession.ts` - Chromium request provenance and capability injection.
- `redeven:desktop/src/main/codespaceNativeGateway.ts` - Bound HTTP and opaque upgrade forwarding.
- `redeven:desktop/src/main/codespaceNativeRemote.ts` - Published isolated acquisition and Node controller integration.
- `redeven:internal/codeapp/appserver/native_http.go` - Shared generation-bound editor handler.
- `redeven:internal/localui/native_codespace.go` - Local authorization, credential isolation, and revocation.
- `redeven:internal/agent/native_codespace.go` - Remote Code App stream registration and request permission checks.
- `redeven:desktop/scripts/check-codespace-native-electron.mjs` - Opt-in real Electron acceptance harness.
- `redeven:desktop/scripts/check-codespace-native-remote.mjs` - Opt-in encrypted native remote acceptance harness.
- `redeven:internal/runtimeservice/compatibility_contract.json` - Authoritative compatibility decision.
