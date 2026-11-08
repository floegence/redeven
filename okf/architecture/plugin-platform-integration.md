---
type: Architecture Contract
title: Plugin platform integration
tags: [architecture, plugins, local-ui, redevplugin]
quality_exception: Cross-domain host integration contract spanning identity, security, runtime, storage, routes, surfaces, and business adapters.
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Redeven mounts one released ReDevPlugin Host/HTTP namespace/client/scope. Unproven identity fails closed. Mount one released Host/HTTP namespace/client/scope at an explicit root. Session close uses released durable four-hash drain;remove authentication after exact acknowledgement.

# Contract

[Adapters](redevplugin-redeven-adapters.md) owns module composition and product mappings; [lifecycle](redevplugin-package-lifecycle.md) owns package inspection.

Local generations cancel replaced waits/fence late credentials. Shutdown closes Local UI/hijacked admission,cancels Agent sessions,drains leases/handlers,then idempotent Host close. Runtime binds canonical sibling executable,target,published IPC/WASM ABI,exact build,lease replay and limits. [Package](redevplugin-package-lifecycle.md),[process](plugin-process-sessions.md),[background](plugin-background-entries.md),[recovery](redevplugin-surface-recovery.md) own lifecycle;[containers](container-resources-capability.md) is separate.

Activity gets fresh SDK slots in stable Shell-root windows;responsive chrome cannot remount/adopt iframe. Workbench uses projected widgets. Lost close replies reconcile exact authority,disposal alone no revocation. Each placement has independent iframe/slot using product-prepared origin and released WebSDK. HTML/CSS/ESM/Canvas/WebGL needs no product renderer;children cannot borrow parent credentials/management.

Pure Web resources use released KV/SQLite/files/settings directly. Product forwards binary requests without buffering/protocol translation or replacing Surface/session checks. Actions use existing Execution/Event bridge;backend/background uses Worker lifecycle. Atomic file staging/coalesced snapshot watches imply neither zero-copy nor change log.

# Boundaries

[Host integration](redevplugin-boundary.md) owns platform separation. Activity, Workbench, windows/widgets, inventory keys, navigation/settings and product layout are never manifest fields.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:1` - Source.
- `redeven:internal/envapp/ui_src/src/test/pluginWebBrowser.fixture.ts:1` - Opt-in real Center/Gateway Web UI: modules, browser Worker, Canvas, private KV/settings/SQLite, binary file roundtrip, slots and close/revoke. This fixture does not qualify backend WASM execution.
- `redeven:internal/redevpluginintegration/runtime_io_live_test.go:1` - Opt-in published author Worker: build the released init --template worker project with plugin ID dev.redeven.qualification.worker, package its built output, and provide REDEVEN_TEST_AUTHOR_PLUGIN_PACKAGE plus the verified product-built REDEVEN_TEST_PLUGIN_RUNTIME. TestPublishedAuthorWorkerRunsThroughRedevenRuntime checks a real WASM result, structured plugin rejection and a successful subsequent invocation.
