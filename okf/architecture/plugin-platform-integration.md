---
type: Architecture Contract
title: Plugin platform integration
tags: [architecture, plugins, local-ui, redevplugin]
quality_exception: Cross-domain host integration contract spanning identity, security, runtime, storage, routes, surfaces, and business adapters.
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Redeven mounts one released ReDevPlugin Host/HTTP namespace/client/scope. Published Supervisor runs verified Linux/Darwin runtime. Product supplies sessions, sources, placement and adapters; platform owns package/state/protocol/trust/execution. Unproven identity fails closed.

# Contract

- `internal/redevpluginintegration` passes an explicit state root and core, official-release, runtime, connectivity, secret, capability and external-package modules. External sources use bounded public HTTPS, GitHub Release resolution and upstream signature assessment.
- Session close uses the released durable four-hash coordinator; remove authentication only after exact drain acknowledgement. Process-local connection generations cancel replaced waits and reject late credentials.
- Shutdown closes Local UI admission/hijacked transports, cancels Agent sessions, drains request leases/handlers, then invokes idempotent Host teardown.
- [Package lifecycle](redevplugin-package-lifecycle.md), [process sessions](plugin-process-sessions.md), [background entries](plugin-background-entries.md) and [surface recovery](redevplugin-surface-recovery.md) own their detailed contracts.
- Runtime binds the canonical sibling executable, target, released IPC/WASM ABI, exact product build, lease replay storage and limits. [Native container resources](container-resources-capability.md) owns the separate product container capability.
- Activity targets receive fresh SDK slots in stable Shell-root windows; responsive chrome cannot remount/adopt iframes. Workbench uses projected plugin widgets. Lost close responses reconcile through exact-surface authority; disposal alone is not revocation.

## Ordinary Web placement

A surface opens through the released Web SDK using an origin prepared by its product transport. The same package can use browser-native HTML, CSS, ES modules, Canvas and WebGL without a product renderer. Each simultaneous placement owns its own iframe and slot. Desktop and browser child-origin requests cannot access product management routes or borrow the parent's private bridge token.

Pure Web applications can declare their own private resources and call the
released KV, database, file and settings SDK directly. Product routes forward
resource requests without replacing the platform's Surface/session checks or
buffering binary bodies into a product protocol. Public actions stay on the
existing bridge and Execution/Event contract; backend or background work uses
the released Worker lifecycle. File uploads use atomic staging, and snapshot
watches coalesce intermediate changes. Neither implies zero-copy or a change log.

# Boundaries

[Host integration](redevplugin-boundary.md) owns platform separation. Activity, Workbench, windows/widgets, inventory keys, navigation/settings and product layout are never manifest fields.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:1` - Source.
- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Source.
- `redeven:internal/envapp/ui_src/src/test/pluginWebBrowser.fixture.ts:1` - Opt-in real Center/Gateway Web UI: modules, browser Worker, Canvas, private KV/settings/SQLite, binary file roundtrip, slots and close/revoke. This fixture does not qualify backend WASM execution.

- `redeven:internal/redevpluginintegration/runtime_io_live_test.go:1` - Opt-in published author Worker: build the released init --template worker project with plugin ID dev.redeven.qualification.worker, package its built output, and provide REDEVEN_TEST_AUTHOR_PLUGIN_PACKAGE plus the verified product-built REDEVEN_TEST_PLUGIN_RUNTIME. TestPublishedAuthorWorkerRunsThroughRedevenRuntime checks a real WASM result, structured plugin rejection and a successful subsequent invocation.
