---
type: Runtime Contract
title: Local UI surface
tags: [architecture, local-ui, runtime, security]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Local UI supports independent concurrent Desktop/browser sessions. Versioned SQLite owns one-shot authorization/spend; network policy owns exposure/password/certificates/migrations. Local UI bind parsing accepts `localhost`, canonical loopback IP literals, concrete non-loopback unicast IPv4 and IPv6 literals, and the `0.0.0.0` and `::` wildcards.

# Contract

## Mechanism
`localui.Server` is built with an agent, Code App app server, bind spec, runtime-control socket path, Local Environment identity, diagnostics store, and optional access gate.

In-process maps retain only active-session cleanup projections and never authorize a request.

## Concurrent shutdown
Context cancellation and explicit shutdown enter the same serialized close path. Runtime-control and management status serialize start/close and protect endpoint reads, so overlapping shutdown cannot dereference cleared servers or advertise a retired control listener. This uses bounded in-process locks and does not introduce durable lifecycle state.

## Session event observation
All built-in Env App event subscriptions use the current authenticated Flowersec session's HTTP proxy. Short bootstrap requests and native file/media requests stay independent of session acquisition.

# Boundaries

Public Env App shell GET/HEAD requests may pass before unlock so the login page can load.
The initial Activity and Workbench unlock forms remain outside the inert protected workspace. A visible heading alone does not establish readiness: password input and Unlock must be operable before a privileged connection starts. Recovery of a previously mounted workspace preserves its inert boundary while exposing the recovery overlay.

The private listener accepts only its canonical numeric-loopback Host or a validated per-forward `.localhost` virtual Host.

Saved next-start settings never replace the running URL list.

# Evidence

- `redeven:internal/localui/localui.go:50` - Source.
- `internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx` verifies both initial gate placements and authorization ordering; `scripts/checkPackagedRenderer.mjs` in the same UI package verifies real password input in the production build.
