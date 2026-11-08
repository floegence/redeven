---
type: Runtime Contract
title: Env App session event transport
tags: [architecture, env-app, transport, events]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

One Floe HTTP proxy runtime serves each Env App session and all built-in/plugin logical event streams. Features cannot consume parallel native HTTP/1.1 slots, retarget upstream identity or create another transport. Session multiplexing removes those event requests from the browser HTTP pool; changing request priority alone cannot do so.

# Contract

## One session and one request path
Product subscriptions call the Shell-bound session event reader. Floe Webapp's acquisition lifecycle opens a logical HTTP stream on the current Flowersec session and parses SSE with its shared bounded parser.

## Authority and resource lifetime
Local session issuance declares only Env App API and plugin API paths plus the plugin CSRF and expected-management-revision headers. Remote issuers must declare the same plugin request authority and upload cap in their signed scope.

Product code must not reset a successful response while its bytes are still being consumed.

## Observation and recovery
Flower maintains one workspace stream; thread selection never reconnects it.

Its transport and cancellation regression coverage remain intact.

# Boundaries

An observer cannot choose another upstream, session identity or native HTTP transport. Ending an observation does not cancel the feature's background business operation.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/services/sessionHTTP.ts` - Source.
