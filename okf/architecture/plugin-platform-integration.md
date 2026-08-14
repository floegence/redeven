---
type: Architecture Contract
title: Plugin platform integration
description: Redeven mounts ReDevPlugin v1.1.3 and adds authenticated host modules, copied-root recovery, market-backed official releases, external-source policy, localized plugin presentation, product placement, and business adapters.
tags: [architecture, plugins, local-ui, redevplugin]
timestamp: 2026-07-25T00:00:00Z
quality_exception: Cross-domain host integration contract spanning identity, security, runtime, storage, routes, surfaces, and business adapters.
---
# Summary

Redeven integrates ReDevPlugin `v1.1.3` through one Go Host, one canonical HTTP
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
external module uses the bounded public HTTPS fetcher, GitHub Release resolver,
and package signature assessor. Inspections are process-local, opaque, and
TTL-bounded; no Redeven or ReDevPlugin stage/receipt/query database is opened.

AppServer mounts the released handler at `/_redevplugin/api/plugins`. It proves
an Env-trusted route, binds the exact trusted origin in server-only context, and
supplies the authenticated channel id. It does not flatten the wire contract,
translate to a second namespace, or serve a parallel package or bootstrap path.
The same session adapter backs direct Host and mounted HTTP authorization.

Persistent resources follow released `user` or `environment` scopes. Short-lived
surfaces, Executions, Events, handles, confirmations, and tokens bind the full
active owner-session, owner-user, owner-environment, and channel audience.
Session close uses the released durable four-hash coordinator and authentication
state is removed only after exact drain acknowledgement.

## Session authority and teardown

Each authenticated channel receives one process-local generation. Creation is
bound to the exact runtime instance that owns the already-held `agent.lock`; the
Host rejects caller assertions, a second lock, or a generation from another
process. Redeven's registry stores only plugin credential hashes, admits requests
through one reference-counted lease, and moves a generation through
`active -> retired -> terminal` without replacing an active channel in place.

Local UI plugin credentials additionally bind a server-generated access-session
id. The id remains internal and follows one resume lineage; the raw credential is
kept only in Env App memory. Logout, active expiry, direct transport EOF, and
server shutdown stop mint and request admission, remove pending artifacts, close
the exact WebSocket set, and retire only generations owned by that access session.
No-password mode scopes the access session to one direct connection.

For direct local transport, the Env App stages each credential against the exact
channel id returned by the connect artifact. It does not publish that credential
to ReDevPlugin request headers until the Flowersec direct handshake reports
success for the same channel. Inventory loading and release-install Execution
observation are gated on this activation, so a reconnect or concurrent artifact
cannot cause an unauthenticated request to be projected as an internal plugin
failure. A handshake for an unknown channel leaves the credential unpublished
and the original staged state untouched.

The Host owns durable session-scope teardown identity, phase, continuation,
terminal claim, migration, and reconciliation in its control database. Redeven's
`PluginSessionGeneration` is transient connection identity only; it cannot become
a second durable lifecycle owner. Shutdown closes Local UI admission and hijacked
transports before canceling Agent sessions, waits for request leases and session
handlers, and then invokes the released idempotent Host teardown path.

## Copied owner-scope recovery

Automatic owner-scope preparation remains the only normal startup path. When a
supported copied root has a migration journal bound to another filesystem
identity, Redeven invokes the released read-only recovery inspection only after
normal preparation fails. Unknown, corrupt, ambiguous, tampered, unsupported,
or future state still returns the original startup failure without a recovery
proposal.

An eligible Desktop startup report contains only the exact recovery-plan digest,
root-identity digest, source-snapshot digest, source entry and byte counts, and
retained-state flags. Desktop binds that proposal to the exact Local Environment
and does not expose root or archive paths. Cancel performs no operation. Confirm
runs the bundled `redeven plugin-state-recovery recover` command under the same
Local Environment runtime lock and supplies the reviewed plan digest plus an
explicit retained-archive/fresh-generation acknowledgement.

The released recovery atomically retains the complete source tree as an inactive
archive and commits a new empty active generation. Redeven verifies the returned
plan, archive outcome, fresh generation, and restart reuse before opening stores.
Archived plugins, grants, settings, secrets, and storage never become active. A
stale plan triggers a new startup inspection and a new user review; it is never
silently accepted or retried with broader authority.

## Package sources and lifecycle

Production obtains the official Containers `4.4.4` release from the frozen
latest-only market snapshot. The snapshot identifies the immutable GitHub
Release and complete signed transport; it does not carry package bytes or grant
trust. Redeven starts one released install Execution and observes ordered Events
through the generated start/list/get/Event client. Publisher, plugin, version,
SHA-256 hashes, Ed25519 root and package signatures, revocation evidence, source
policy, host requirement, and the Host-registered known capability contract must
all match before ReDevPlugin changes the registry. Invalid, revoked, or
incomplete evidence fails closed without falling back to external admission.

Host restart and explicit retry use the Host-owned recovery snapshot and
`recoverEnabled` path. Redeven observes and localizes the authoritative result;
it does not persist release trust, activation evidence, recovery identities, or
a second grant/trust state machine.

Administrators may also inspect packages from:

- a public HTTPS URL to a compatible `.redevplugin` package;
- a public GitHub repository Release, with an optional exact tag;
- a local `.redevplugin` upload.

Every source uses released `inspect -> explicit confirmation -> install`.
Inspection returns a process-local opaque id with a bounded TTL and binds package
bytes, source provenance, owner/session, intent, security summary, signature
assessment, execution approval, update eligibility, and confirmation digest.
Install presents the exact id and expected hash; the Host reopens and revalidates
the exact bytes/hash and enters its single atomic control-database transaction.
Redeven neither persists inspection/receipt/query state nor parses packages or
manufactures provenance or trust state.

Unsigned, unknown-signer, and temporarily unverifiable packages may be installed
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
`1.1.3`, runtime-internal IPC and WASM ABI contracts, exact product-build descriptor, lease
replay storage, and released limits. Linux runtime bytes are built with Rust
1.88.0 from the attested package set and travel with SBOM, provenance, notices,
and signature evidence. The expected binary digest comes from the product release
marker; field binary bytes are never hashed and accepted as their own trust
anchor. Missing, non-canonical, wrong-target, unsigned, or wrong-hash runtime
evidence blocks startup. Darwin constructs no runtime module.

The Containers adapter receives only ReDevPlugin-authorized calls. Reads, long
operations, cancellation, and log streams use the released Execution/Event
envelope; Docker/Podman access stays in the product capability
package. Installation and enablement do not imply resource access. The initial
Containers surface requires an active `containers.read` grant, and the product
shows that requirement before attempting to open the surface.

The Containers operation observation and candidate-release boundary is owned by
[Containers operation observation](containers-operation-observation.md).

## Env App inventory and permissions

Env App owns one authenticated fetch adapter, one released client, one shared
scope, and one placement coordinator. Generated DTOs drive lifecycle,
external-package, generic permission-requirement, and interaction calls. Every
mutation carries its current management and applicable policy/revoke revisions;
committed and unknown management outcomes rely on Host revocation followed by
the SDK's scope teardown, then refresh state without a second slot-close path or
blind mutation retry.

Official installation is product-observable but platform-owned. The Shell keeps
one coordinator keyed by `plugin_instance_id`; it preserves the original
`request_id`, reattaches to the same Execution after panel close or transport
loss, and renders ordered Host Events for release fetch, package download, hash,
Ed25519 verification, commit, enable, and reconciliation. Byte progress is shown
only when the Host reports bytes; retry attempt
and verified cache-hit details remain explanatory diagnostics rather than
invented percentages. A succeeded operation refreshes inventory and projects
the authoritative enabled or `needs_attention` record; a refresh failure is
shown as a separate recoverable state and never relabeled as an install failure.
Only a confirmed terminal, retryable failure may create a new request. On Env
App startup, only the newest Execution for each plugin is eligible for
restoration: active work is always reattached, while a terminal failure remains
visible for 24 hours so a restart does not erase its diagnosis. An older failure,
a failure superseded by a later success, or an expired failure does not return as
stale product state.

Plugin runtime recovery starts from the explicit authenticated plugin-session
ready transition; Env App does not insert a fixed timer. It requests the Host's
idempotent `recoverEnabled` snapshot and presents per-instance state and explicit
retry. The Host owns recovery identity, single-flight behavior, and the
authoritative snapshot. Env App owns no failed-instance or catch-up state machine,
and recovery presentation never becomes a second surface-open gate.

Every opened surface receives the released `redevplugin.surface_context.v1`
with a monotonic revision, semantic light/dark palette, language tag, and text
direction. Env App observes locale and shell-theme changes, calls the released
slot host `updateContext` for the same iframe, and never remounts a surface to
apply appearance. Context revision starts at one for each fresh slot; duplicate
appearance or locale projections do not increment it.

The inventory projects verified market catalog entries and every installed instance as
separate records. Navigation, tile selection, and detail state use exact
`inventoryKey`; plugin id and instance id are not product selection keys. Every
installed current-version instance whose publisher, plugin, version, package,
manifest, and entries hashes exactly match the catalog receives catalog metadata,
including the manifest-derived localized presentation, while its trust badge remains
the actual signature assessment. A historical
version without external provenance must carry an explicitly catalog-trusted
official signing key and exact registry-to-Host-verified hash agreement.
External source provenance prevents an identity collision from borrowing
historical official identity or update controls.

Plugin Center cards, detail actions, and the application launcher consume the
Host `action_state` projection. Redeven does not derive open eligibility from
trust, grants, policy, or recovery. A disabled or blocked record never exposes a
surface launch action, even if an old launch target is still present; a runnable
update may keep Activity and Workbench available while its primary action is
review. The launcher omits disabled records, while cards keep enable and review
actions visible. Installed presentation remains authoritative for the installed
package. A market icon descriptor may be reused only when all four installed
release hashes and the version exactly match the current signed market release;
otherwise the installed projection uses the generic placeholder. `PluginIcon`
validates and renders the bounded URL with that fallback and has no plugin-id-
specific behavior.

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
This concept owns only Redeven's concrete `v1.1.3` assembly.

Manifest surfaces remain `view|command|background` with semantic roles. Activity,
Workbench, window, widget, inventory key, navigation, settings, and product layout
never become manifest fields.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:1` - Opens Host modules and the canonical handler.
- `redeven:internal/redevpluginintegration/owner_scope_recovery.go:1` - Projects released copied-root inspection and exact-plan recovery without editing opaque state.
- `redeven:cmd/redeven/plugin_state_recovery.go:1` - Requires the Local Environment lock and explicit retained-archive confirmation.
- `redeven:desktop/src/main/pluginStateRecovery.ts:1` - Validates the bundled recovery command result and preserves stale-plan outcomes.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ExternalPluginInstallDialog.test.tsx:1` - Exercises inspect, explicit confirmation, Host install, and disabled zero-grant presentation.
- `redeven:spec/redevplugin/artifacts.go:1` - Pins official package keys and loads the generated known v4 capability contract.
- `redeven:internal/redevpluginintegration/session_adapter.go:340` - Maps read and admin external-package actions to explicit product permissions.
- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Configures the released runtime manager and fixed version.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:1` - Uses generated lifecycle, external-package, and permission-requirement APIs.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginSurfaceContext.ts:1` - Projects semantic shell appearance and locale into the released revisioned surface context.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.ts:1` - Projects exact inventory identities, trust, provenance, grants, and requirements.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1120` - Coordinates exact inventory navigation and placement handoff.
- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx:2150` - Persists and reconciles plugin Workbench widgets.
