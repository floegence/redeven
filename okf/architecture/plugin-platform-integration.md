---
type: Architecture Contract
title: Plugin platform integration
description: Redeven mounts ReDevPlugin v0.6.10 and adds authenticated host modules, external-source policy, product placement, and business adapters.
tags: [architecture, plugins, local-ui, redevplugin]
timestamp: 2026-07-24T00:00:00Z
---
# Summary

Redeven integrates ReDevPlugin `v0.6.10` through one Go Host, one canonical HTTP
namespace, one Env App `PluginPlatformClient`, one shared surface scope, and the
released ProcessManager over a verified Redeven-built Linux runtime. Redeven
adds authenticated session mapping, public-source admission policy, product
placement, and business adapters; ReDevPlugin retains package, state, protocol,
trust, and runtime ownership. Activity supports Shell-root multi-window placement
and Workbench supports standard projected plugin widgets. Unproven owner,
package, capability, runtime, or surface identity fails closed.

# Contract

## Host construction and routes

`internal/redevpluginintegration` prepares the released owner-scoped generation,
opens ReDevPlugin stores, and constructs the Host with core, official release,
runtime, connectivity, secret, capability, and external-package modules. The
external module uses the released stage store, bounded public HTTPS fetcher,
GitHub Release resolver, and package signature assessor. Host close revokes and
removes pending inspections before Redeven closes the shared stage store.

AppServer mounts the released handler at `/_redevplugin/api/plugins`. It proves
an Env-trusted route, binds the exact trusted origin in server-only context, and
supplies the authenticated channel id. It does not flatten the wire contract,
translate to a second namespace, or serve a parallel package or bootstrap path.
The same session adapter backs direct Host and mounted HTTP authorization.

Persistent resources follow released `user` or `environment` scopes. Short-lived
surfaces, operations, streams, handles, confirmations, and tokens bind the full
active owner-session, owner-user, owner-environment, and channel audience.
Session close uses the released durable four-hash coordinator and authentication
state is removed only after exact drain acknowledgement.

## Package sources and lifecycle

The signed official Containers release module remains available through generated
`installReleaseRef` and `updateReleaseRef` requests, but the current product UI
does not use that path. Its publisher, plugin, instance, version, hashes, signing
evidence, source policy, host requirement, revocation evidence, and capability
pin must all match; expired evidence fails closed without an install record. The
normal catalog action instead opens external-package review with an HTTPS URL
pinned to the immutable commit containing an unsigned catalog package. That
package is deterministically derived from the same release content by removing
only the release-context signature, and its package, manifest, and entries hashes
must still equal the catalog release. No new official signing or authorization
flow is implied.

Administrators may also inspect packages from:

- a public HTTPS URL to a compatible `.redevplugin` package;
- a public GitHub repository Release, with an optional exact tag;
- a local `.redevplugin` upload.

Every source uses the released `inspect -> commit -> query` transaction. The
inspection binds immutable package bytes and source provenance to its owner,
intent, security summary, signature assessment, execution approval, update
eligibility, and confirmation digest. Commit must present the exact inspection
id and digest. Once a commit has an unknown or in-progress outcome, every later
attempt for that inspection is query-only until a committed or failed terminal
result; bounded UI reconciliation never replays the mutation. Redeven neither
parses packages nor manufactures provenance or trust state.

Unsigned, unknown-signer, and temporarily unverifiable packages may be committed
after explicit confirmation. The installed record remains disabled, receives no
permission grants, and is manual-update-only. Invalid or revoked signatures are
blocked. A later update remains bound to the installed instance and current
management revision. GitHub updates may reuse the stored public repository
identity; package-URL updates require the administrator to enter the URL again,
and upload updates require a new file selection. Redeven never reconstructs a
reusable URL from redacted provenance origin/path fields. A GitHub source without
an administrator-entered tag resolves the latest eligible Release on each new
inspection; the previously resolved release tag is evidence, not a new durable
user pin.

## Runtime and Containers

The runtime module binds the canonical sibling executable, target, ReDevPlugin
`0.6.10`, released Rust IPC and WASM ABI, exact product-build descriptor, lease
replay storage, and released limits. Linux runtime bytes are built with Rust
1.88.0 from the attested package set and travel with SBOM, provenance, notices,
and signature evidence. Missing, non-canonical, wrong-target, unsigned, or
wrong-hash runtime evidence blocks startup. Darwin constructs no runtime module.

The Containers adapter receives only ReDevPlugin-authorized calls. Reads, long
operations, cancellation, and log streams use released capability, operation,
and stream envelopes; Docker/Podman access stays in the product capability
package. Installation and enablement do not imply resource access. The initial
Containers surface requires an active `containers.read` grant, and the product
shows that requirement before attempting to open the surface.

## Env App inventory and permissions

Env App owns one authenticated fetch adapter, one released client, one shared
scope, and one placement coordinator. Generated DTOs drive lifecycle,
external-package, generic permission-requirement, and interaction calls. Every
mutation carries its current management and applicable policy/revoke revisions;
committed and unknown management outcomes rely on Host revocation followed by
the SDK's scope teardown, then refresh state without a second slot-close path or
blind mutation retry.

The inventory projects official catalog entries and every installed instance as
separate records. Navigation, tile selection, and detail state use exact
`inventoryKey`; plugin id and instance id are not product selection keys. Every
installed current-version instance whose publisher, plugin, version, package,
manifest, and entries hashes exactly match the catalog receives catalog metadata,
including the Containers permission presentation, while its trust badge remains
the actual signature assessment. This lets the generated instance created by the
unsigned catalog transaction replace the Discover card without being mislabeled
as signed. A historical
version without external provenance must carry an explicitly catalog-trusted
official signing key and exact registry-to-Host-verified hash agreement.
External source provenance prevents an identity collision from borrowing
historical official identity or update controls.

Active grants and explicit security policy join the exact installed record.
Generic requirements come only from the released Host projection of the active
version's verified capability contracts. Admin grant/revoke uses revision
fences; non-admin sessions are read-only. An allowlist cap, denied method, and
active grant remain distinct facts. Generic review and confirmation copy names
the exact permission id instead of substituting an official-plugin label.

## Placement

Each Activity target owns a fresh SDK slot inside one stable Shell-root floating
window. Multiple windows may remain mounted; desktop owns move, resize, stacking,
and geometry, while mobile presents only the active full-screen window to input
and accessibility. Responsive chrome never remounts or adopts the iframe.

Workbench persists plugin targets in standard `redeven.plugin` widgets. The
released source/port-bound interaction callback drives only Redeven's projected
wheel, text-selection, action, activation, focus, and floating-layer markers.
It does not become an authorization input or a second bridge.

Opening the same placement reactivates it. Moving between Activity and Workbench,
replacing a Workbench revision, or deleting a widget globally serializes the
transition and awaits exact old-slot close before persisting or opening the new
placement. The new target always receives a fresh slot lease and iframe. A lost
close response is reconciled by the released exact-surface contract; local
disposal alone is not revocation evidence.

# Boundaries

Canonical ownership is defined by [ReDevPlugin host integration boundary](redevplugin-boundary.md).
This concept owns only Redeven's concrete `v0.6.10` assembly.

Manifest surfaces remain `view|command|background` with semantic roles. Activity,
Workbench, window, widget, inventory key, navigation, settings, and product layout
never become manifest fields.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:1` - Opens Host modules and the canonical handler.
- `redeven:internal/redevpluginintegration/external_package_test.go:24` - Exercises upload inspect, confirmed commit, query, disabled state, and staged-artifact cleanup.
- `redeven:spec/redevplugin/artifacts.go:1` - Binds the unsigned catalog package to the exact verified Containers release content.
- `redeven:internal/redevpluginintegration/session_adapter.go:340` - Maps read and admin external-package actions to explicit product permissions.
- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Configures the released runtime manager and fixed version.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:1` - Uses generated lifecycle, external-package, and permission-requirement APIs.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.ts:1` - Projects exact inventory identities, trust, provenance, grants, and requirements.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1120` - Coordinates exact inventory navigation and placement handoff.
- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx:2150` - Persists and reconciles plugin Workbench widgets.
