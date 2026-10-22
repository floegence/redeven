---
type: Runtime Contract
title: Native Desktop CodeSpace access
description: Bind a Desktop editor origin to one authorized CodeSpace through the current environment transport.
tags: [desktop, codespace, security, transport]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop owns each built-in CodeSpace window, persistent browser profile, protected loopback listener, and outgoing route. Runtime owns the running editor generation and current permission and access gates. The editor receives normal HTTP and WebSocket traffic without a privileged preload, browser transport injection, or replacement WebSocket implementation. Closing the window, revoking access, or stopping its instance ends the owned connections. An unavailable route or occupied saved port fails that CodeSpace without switching transports or replaying application traffic.

# Contract

## Trusted opening requests
The trusted environment root frame submits `loading` or `open` with a DNS-safe CodeSpace ID. [Whole-window status surfaces](../ui/window-status-surfaces.md) owns its shared visual treatment and progress indication.

## Window navigation and recovery
One native-window owner controls the loading document, editor navigation, readiness, and connection resources. Background theme refreshes never present or focus the window.

Page-navigation failures have distinct localized copy from route unavailability; credentials, raw exception messages, and error URLs do not enter these diagnostics.

## Window and profile identity
Each profile hashes the stable environment/resource identity, including control-plane and user identity where present. An occupied port reports an actionable error; Desktop never contacts its occupant or allocates a replacement origin for that profile.

Navigation leaves the editor origin only through the system browser.

## Selected environment route
Native and placement sessions reuse the current private Local UI bridge and token. Native routing never starts another Runtime, creates an SSH forward, falls back to public Local UI, or changes certificate verification.

Passwords are ephemeral and never enter editor storage, URLs, or logs.

## Runtime boundary and HTTP semantics
The Local UI descriptor resolves only an already-running CodeSpace, returns its generation and Runtime-owned `access_cookie_name`, and requires full effective read/write/execute permissions plus the current AccessGate.

It never retries a submitted request or terminal input. Published Flowersec owns ByteStream-to-Node-Duplex and Go HTTP stream adaptation; Redeven contains only its resource routing and authorization adapters.

## Compatibility and validation
Compatibility epoch 14 introduced isolated system-browser presentation origins while preserving the epoch 13 HTTP/stream contract and epoch 12 storage-generation fence. The current Redeven pair consumes Flowersec 5.10.5 and Floe Webapp 0.86.5 without sibling source wiring.

# Boundaries

The opt-in Electron fixture exercises the production window owner through loading-document handoff, editor readiness, same-origin redirects, document, Worker, Service Worker and WebSocket requests, and unauthenticated loopback rejection. Focused HTTP tests cover authorization, generation rejection, raw bytes, upgrade heads, cookies, and origin conflicts.

# Evidence

- `redeven:desktop/src/main/codespaceNativeWindows.ts` - Single-window navigation, readiness, cancellation, and bounded failure diagnostics.

- `redeven:desktop/src/main/codespaceNativeWindows.test.ts` - Deterministic document-ordering, retry, concurrent-open, and late-close regression coverage.

- `redeven:desktop/src/shared/desktopShellCodespaceWindowIPC.ts` - ID-only trusted shell request contract.
