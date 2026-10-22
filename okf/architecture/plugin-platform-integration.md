---
type: Architecture Contract
title: Plugin platform integration
description: Redeven mounts released ReDevPlugin v3 and adds authenticated host modules, market-backed official releases, external-source policy, localized plugin presentation, product placement, and business adapters.
tags: [architecture, plugins, local-ui, redevplugin]
timestamp: 2026-10-08T00:00:00Z
quality_exception: Cross-domain host integration contract spanning identity, security, runtime, storage, routes, surfaces, and business adapters.
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven integrates the released ReDevPlugin v3 through one Go Host, one canonical HTTP
namespace, one Env App `PluginPlatformClient`, one shared surface scope, and the
released Process Supervisor over a verified Redeven-built Linux or Darwin runtime. Redeven
adds authenticated session mapping, public-source admission policy, product
placement, and business adapters; ReDevPlugin retains package, state, protocol,
trust, and runtime ownership. Activity supports Shell-root multi-window placement
and Workbench supports standard projected plugin widgets. Unproven owner,
package, capability, runtime, or surface identity fails closed.

# Contract

## Host construction and routes
`internal/redevpluginintegration` passes one explicit product-selected state root to ReDevPlugin and constructs the Host with core, official release, runtime, connectivity, secret, capability, and external-package modules. The external module uses the bounded public HTTPS fetcher, GitHub Release resolver, and package signature assessor.

Session close uses the released durable four-hash coordinator and authentication state is removed only after exact drain acknowledgement.

## Session authority and teardown
Each authenticated channel receives one process-local generation.

Reconnect or replacement cancels the old wait, and a late response cannot publish an older credential.

Shutdown closes Local UI admission and hijacked transports before canceling Agent sessions, waits for request leases and session handlers, and then invokes the released idempotent Host teardown path.

## Delegated package lifecycle
Released package inspection, installation, source policy, and runtime readiness are owned by [Plugin package and runtime lifecycle](redevplugin-package-lifecycle.md).

## Process and background boundary
ReDevPlugin owns the Process Broker, Supervisor, process-tree containment, opaque handles, bounded binary streams, and headless background lifecycle. See [Plugin process sessions](plugin-process-sessions.md) and [Plugin background entries](plugin-background-entries.md).

## Runtime boundary
The runtime module binds the canonical sibling executable, target, released ReDevPlugin v3 runtime-internal IPC and WASM ABI contracts, exact product-build descriptor, lease replay storage, and released limits.

Its Local API, permissions, operation lifecycle, and product surfaces are owned by [Native container resources](container-resources-capability.md).

## Env App inventory and recovery
Authenticated inventory, installation observation, permission finalization, and reconnect recovery are owned by [Plugin surface recovery](redevplugin-surface-recovery.md).

## Placement
Each Activity target owns a fresh SDK slot inside one stable Shell-root floating window. Responsive chrome never remounts or adopts the iframe.

A lost close response is reconciled by the released exact-surface contract; local disposal alone is not revocation evidence.

# Boundaries

Canonical ownership is defined by [ReDevPlugin host integration boundary](redevplugin-boundary.md).

Activity, Workbench, window, widget, inventory key, navigation, settings, and product layout never become manifest fields.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:1` - Opens Host modules and the canonical handler.

- `redeven:internal/redevpluginintegration/session_adapter.go:340` - Maps read and admin external-package actions to explicit product permissions.

- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Configures the released runtime manager and fixed version.
