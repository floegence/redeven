---
type: Runtime Contract
title: Env App session event transport
description: Observe Env App events through the current authenticated session without consuming browser HTTP connection slots.
tags: [architecture, env-app, transport, events]
timestamp: 2026-09-22T00:00:00Z
---
# Summary

Floe Webapp owns one HTTP proxy runtime per connected Env App session. All built-in browser event subscriptions and the ReDevPlugin host request adapter use that runtime's logical streams. They cannot occupy native HTTP/1.1 connection slots, choose another upstream or identity, or create a second transport. Session replacement and teardown cancel old observations. Each feature retains its existing recovery policy; stopping observation never cancels background business work.

# Contract

## One session and one request path

Product subscriptions call the Shell-bound session event reader. Floe Webapp's acquisition lifecycle opens a logical HTTP stream on the current Flowersec session and parses SSE with its shared bounded parser. Redeven validates and maps business payloads only. Local HTTP, TLS, Desktop's private loopback profile, and remote access use this same interface. Remote Service Worker and window bridges share the lifecycle's existing proxy runtime.

There is no native HTTP fallback, parallel subscription, cross-tab leader, SharedWorker, product event bus, or transport-owned retry. Tabs retain their independent authenticated sessions. Bootstrap, login, spend, and other short requests remain independent of the session they establish. Native file and media requests retain their existing authorization and Range behavior.

HTTP/1.1 browsers typically permit six connections per origin. Persistent native requests can exhaust those slots even at low priority, blocking navigation while the server remains responsive. Session multiplexing removes those event requests from the browser HTTP pool; changing request priority alone cannot do so.

## Authority and resource lifetime

Local session issuance declares only Env App API and plugin API paths plus the plugin CSRF and expected-management-revision headers. The ordinary body cap matches the published ReDevPlugin package upload limit of 256 MiB; SSE remains governed by streaming chunk and buffer limits. Remote issuers must declare the same plugin request authority and upload cap in their signed scope. Handler resolution reads the app origin and immutable session binding from the durable authorization store. The agent configures a fixed Runtime AppServer upstream and a trusted internal channel hop. Permissions, access lock, Origin, CSRF, plugin ownership, and revocation remain enforced by existing handlers. A browser cannot nominate an upstream, environment, user, or internal session header.

The acquisition lifecycle cancels active requests on waiting, failure, replacement, and disposal, and fences already-parsed old events. Request cancellation, early iterator return, and page closure release the logical stream. The access proxy serializes explicit and context-driven shutdown and closes active observers immediately. Session cleanup releases the proxy; persistent operations remain owned by their services.

Flowersec owns request establishment deadlines, SSE activity timeouts, chunk bounds, backpressure, and admission. SSE is persistent only when both request Accept and response Content-Type identify it. Persistent responses do not inherit ordinary response total-duration or cumulative-body limits. Client and server default HTTP admission is 24 concurrent requests, with at most 16 event streams and 8 positions reserved for ordinary traffic. Excess event subscriptions fail explicitly without an unbounded queue. These limits are subordinate to existing session resources and do not create a new terminal or RPC owner.

## Observation and recovery

Flower maintains one workspace stream; thread selection never reconnects it. Disconnect refreshes workspace summaries and the selected current view. Summary events do not overwrite cached detail. Workbench, Notes, plugin market, diagnostics, container logs and metrics, container operations, Managed Service operations, and host-application preparation keep their existing cursors, snapshot restoration, and operation identity.

Feature controllers own reconnection. Authorization and access-lock failures terminate the observer instead of retrying indefinitely. Closing a progress view, losing its transport, or disposing the page cannot issue a business cancellation command. Explicit operation cancellation remains a separate user action.

ReDevPlugin's released SDK owns its platform request and event contracts. Redeven's fetch adapter contributes only canonical API validation, CSRF proof, and current-session transport. It does not copy SDK parsing or recovery behavior.

Desktop Welcome's main-process Node HTTP reader is an independent maintained consumer. It uses the released SSE parser and does not consume browser connection slots. Its transport and cancellation regression coverage remain intact.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/services/sessionHTTP.ts` - Product binding to the lifecycle's fetch and event APIs, with no retry or fallback.
- `redeven:internal/envapp/ui_src/src/ui/services/connectionRuntime.ts` - All connection profiles bind and release the current lifecycle.
- `redeven:internal/agent/agent.go` - Shared local and remote Env session proxy registration against the fixed AppServer.
- `redeven:internal/localui/authorization_store.go` - Current-session HTTP scope and persisted app-origin binding.
- `redeven:internal/codeapp/appserver/server_test.go` - Session identity, permission, and revoked/wrong-surface rejection.
- `redeven:internal/accessproxy/server_e2e_test.go` - Active observation cancellation during overlapping close paths.
- `redeven:internal/envapp/ui_src/src/ui/services/eventStreamRequestPolicy.test.ts` - Domain payload/cursor mapping and cancellation without native event requests.
- `redeven:internal/envapp/ui_src/scripts/checkEnvSessionRefresh.mjs` - Eight documents, twenty bounded refreshes, cross-document event delivery, one session per document, and socket-pool evidence.
- `redeven:internal/envapp/ui_src/scripts/checkFilePreviewMedia.mjs` - Actual Notes observation alongside Activity/Workbench media play, seek, and reopen under 3G classification.
