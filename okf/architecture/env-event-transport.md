---
type: Runtime Contract
title: Env App session event transport
description: Observe Env App events through the current authenticated session without consuming browser HTTP connection slots.
tags: [architecture, env-app, transport, events]
timestamp: 2026-09-22T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floe Webapp owns one HTTP proxy runtime per connected Env App session. All built-in browser event subscriptions and the ReDevPlugin host request adapter use that runtime's logical streams. They cannot occupy native HTTP/1.1 connection slots, choose another upstream or identity, or create a second transport. Session replacement and teardown cancel old observations. Each feature retains its existing recovery policy; stopping observation never cancels background business work.

# Contract

## One session and one request path
Product subscriptions call the Shell-bound session event reader. Floe Webapp's acquisition lifecycle opens a logical HTTP stream on the current Flowersec session and parses SSE with its shared bounded parser.

Session multiplexing removes those event requests from the browser HTTP pool; changing request priority alone cannot do so.

## Authority and resource lifetime
Local session issuance declares only Env App API and plugin API paths plus the plugin CSRF and expected-management-revision headers. Remote issuers must declare the same plugin request authority and upload cap in their signed scope.

Product code must not reset a successful response while its bytes are still being consumed.

## Observation and recovery
Flower maintains one workspace stream; thread selection never reconnects it.

Its transport and cancellation regression coverage remain intact.

# Boundaries

An observer cannot choose another upstream, session identity or native HTTP transport. Ending an observation does not cancel the feature's background business operation.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/services/sessionHTTP.ts` - Product binding to the lifecycle's fetch and event APIs, with no retry or fallback.

- `redeven:internal/envapp/ui_src/src/ui/services/connectionRuntime.ts` - All connection profiles bind and release the current lifecycle.

- `redeven:internal/agent/agent.go` - Shared local and remote Env session proxy registration against the fixed AppServer.
