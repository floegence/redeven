---
type: Architecture Contract
title: Plugin platform integration
tags: [architecture, plugins, local-ui, redevplugin]
quality_exception: Cross-domain host integration contract spanning identity, security, runtime, storage, routes, surfaces, and business adapters.
lifecycle: contract
reviewed_at: "2026-10-30"
---
# Summary

Redeven mounts released ReDevPlugin through one Go Host, HTTP namespace, Env App client and surface scope. Published Process Supervisor runs a verified product-built Linux/Darwin runtime. Redeven adds authenticated sessions, source policy, placement and business adapters; upstream owns package, state, protocol, trust and execution. Missing or unproven identities fail closed.

# Contract

- `internal/redevpluginintegration` passes an explicit state root and core, official-release, runtime, connectivity, secret, capability and external-package modules. External sources use bounded public HTTPS, GitHub Release resolution and upstream signature assessment.
- Session close uses the released durable four-hash coordinator; remove authentication only after exact drain acknowledgement. Process-local connection generations cancel replaced waits and reject late credentials.
- Shutdown closes Local UI admission/hijacked transports, cancels Agent sessions, drains request leases/handlers, then invokes idempotent Host teardown.
- [Package lifecycle](redevplugin-package-lifecycle.md), [process sessions](plugin-process-sessions.md), [background entries](plugin-background-entries.md) and [surface recovery](redevplugin-surface-recovery.md) own their detailed contracts.
- Runtime binds the canonical sibling executable, target, released IPC/WASM ABI, exact product build, lease replay storage and limits. [Native container resources](container-resources-capability.md) owns the separate product container capability.
- Activity targets receive fresh SDK slots in stable Shell-root windows; responsive chrome cannot remount/adopt iframes. Workbench uses projected plugin widgets. Lost close responses reconcile through exact-surface authority; disposal alone is not revocation.

## Ordinary Web placement

A surface opens through the released Web SDK using an origin prepared by its product transport. The same package can use browser-native HTML, CSS, ES modules, Canvas and WebGL without a product renderer. Each simultaneous placement owns its own iframe and slot. Desktop and browser child-origin requests cannot access product management routes or borrow the parent's private bridge token.

# Boundaries

[Host integration](redevplugin-boundary.md) owns platform separation. Activity, Workbench, windows/widgets, inventory keys, navigation/settings and product layout are never manifest fields.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:1` - Opens Host modules and the canonical handler.

- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Configures the released runtime manager and fixed version.

- `redeven:internal/envapp/ui_src/scripts/fixtures/plugin-web-browser.ts:1` - Qualifies a backend-free package through actual Center and Gateway routes: native modules, Worker, Canvas, independent surfaces, unsaved close and forced invalidation. Enable with `REDEVEN_PLUGIN_WEB_QUALIFICATION=1` in the existing explicit browser qualifications; this does not certify Worker backend execution.
