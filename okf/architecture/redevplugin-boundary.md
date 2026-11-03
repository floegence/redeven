---
type: Architecture Boundary
title: ReDevPlugin host integration boundary
tags: [architecture, dependencies, plugins, release]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Redeven consumes coordinated released ReDevPlugin Go/npm/Rust/machine artifacts. Product owns sessions, source review, placement, runtime builds and business adapters. Missing or unverifiable platform contracts fail without copied mechanics, sibling imports or compatibility fallback.

# Contract

## Ownership
Upstream owns validation/hash/trust, inspection/registry, permission/confirmation, tokens/assets, sandbox/bridge, settings/intents, Executions/Events, storage/network/secrets, supervision/IPC/WASM, quotas/revocation, control state and releases/contracts. One coordinated release; frontend cannot downgrade independently. Manifests/dependency tests own pins; bootstrap retains bounded credentials before readiness. [Packages](redevplugin-package-lifecycle.md) owns admission/cache, [adapters](redevplugin-redeven-adapters.md) product modules/display.

## Availability
Plugin readiness cannot block Runtime/ordinary sessions. Market/package/runtime/storage/init failure stays local; retain files/terminal/Notes/Workbench. PLUGIN_RUNTIME_UNAVAILABLE executes nothing; rejected writes report not_committed. Localize faults; unreadable inventory is not empty, auto-failure never global interruption. Init budget10s; cancel fences results/closes integration. Error/panic unwinds construction without hiding host cancellation.

Channel auth is separate: failed/panicked binding grants nothing and cannot close host channel. Request panic releases admission; HTTP contains failure. Incompatible opaque state stays unchanged, never reauthorized.

## Network/history
ReDevPlugin3.12.0 separates routing/package verification/execution. Single-hop host transports honor explicit proxy,current macOS proxy/PAC,OS DNS/VPN for market/package/release. Synthetic/private addresses alone are not denial. Upstream validates URL/redirect/origin/size/cancel/hash/signature; downloads grant nothing.

Granted HTTPS hostname connectors without private-prefix binding use released transport factory. Platform checks target/method/grant/revision,pools/quotas/revocation. Private prefixes,literal addresses/other protocols keep address-bound policy. Resolve configuration at request time; faults local.

3.11.2 reads signed pre-Webv9 without changing manifest/hash/signature/generation. Incompatible install stays manageable,not executable/enabled. Explicit same-install Web update retains history; no VNode/invented declarations. Unknown/corrupt stays unchanged/local unavailable.

Platform owns Web admission/package modules/sandbox/bootstrap/bridge. Product allocates origins/mounts handlers; no DOM translation/VNode renderer/ambient parent credentials.

## Runtime performance boundary
Released 3.15 uses one Wasmtime actor/job path with fresh invocation state, bounded in-process compiled-module reuse, finite fuel and signed deadlines. Immutable manifest caching never replaces current permission or revocation checks. Product supplies fixed toolchain, runtime signing and placement policy; it does not add an executor, authorization cache or compatibility fallback. Cold module preparation remains separate from warm execution latency.

## Authoring/execution
Platform owns config/manifest validation,bindings,build/test/package,diagnostics/watch,persistent preview,manual update candidates,connection review,verified dev runtime. Redeven version-derived skill invokes released CLI. Product owns intent/placement/review/install approval and build/signature/SBOM/publication proof; authoring grants no permissions/trust.

3.13.0 owns manifest actions/direct Surface KV/SQLite/files/settings without Worker forwarding. Dedicated-origin binary/WebSocket handler requires exact handshake; Host checks session ceilings/scope/grants/quotas/revoke. Product mounts/presents,never new endpoints/manifest interpretation. SDK conflict/unknown cannot replay; coalesced watches are not logs.

Private files1→chunked2 migration stays upstream, separate from control/author schemas. Snapshots/recovery opaque; no copied SQL/rewrite.3.12.2 retains ordinary packaging/SDK. Trusted parent query/event/cancel binds current surface gateway/plugin; pass exact scope via authenticated transport/released handler. Stale/malformed cannot broaden to management; plugin-origin direct calls denied.

Host enforces read/write ceilings/read-only effects before process operations. SQLite authorizes compiled SQL,excludes host paths,bounds values/complexity/concurrency. Product maps sessions/process adapters only; no new manifest/data flags.

# Boundaries

Never mutate opaque state,mint tokens/trust/grants. Wrong/legacy/drifted/tampered/future roots fail unchanged. Conversion/history binding remains upstream; host shows review/calls update,not converter interpretation,generation copies,DB migration or unknown-write retry. Durable scheduling/claims/restart/uncertainty upstream; host supplies cap adapter/summaries,not retained user sessions/timers/table access.

# Evidence

- `redeven:go.mod:14` - Source.
- `redeven:internal/session/dependency_contract_test.go:1` - Tests.
