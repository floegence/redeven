---
type: Architecture Contract
title: Plugin platform integration
description: Redeven mounts ReDevPlugin v0.7.23 and adds authenticated host modules, copied-root recovery, market-backed official releases, external-source policy, localized plugin presentation, product placement, and business adapters.
tags: [architecture, plugins, local-ui, redevplugin]
timestamp: 2026-07-25T00:00:00Z
quality_exception: Cross-domain host integration contract spanning identity, security, runtime, storage, routes, surfaces, and business adapters.
---
# Summary

Redeven integrates ReDevPlugin `v0.7.23` through one Go Host, one canonical HTTP
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
success for the same channel. Inventory loading and release-install operation
resume are gated on this activation, so a reconnect or concurrent artifact
cannot cause an unauthenticated request to be projected as an internal plugin
failure. A handshake for an unknown channel leaves the credential unpublished
and the original staged state untouched.

The released lifecycle adapter persists the active process/session generation,
phase, exact four-hash identity, close continuation, terminal claim, revision,
and checksum in an atomically replaced generation. Startup accepts only the
current lock authority, strictly migrates recognized v1 state while retaining its
exact bytes, reconciles recoverable interrupted phases, and rejects symlinks,
non-regular files, tampered journals, ambiguous fences, and future state without
mutation. A post-rename durability failure poisons the adapter because the
mutation outcome is unknown.

Shutdown closes Local UI admission and hijacked transports before canceling
Agent sessions. It then waits for request leases, session handlers, and tracked
maintenance workers before closing the Host. A timeout leaves the durable
continuation for the next startup and does not close the Host concurrently with a
callback. Transient maintenance failures retry in the background while the
runtime remains active.

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

Production obtains the official Containers `4.4.1` release from the frozen
latest-only market snapshot. The snapshot identifies the immutable GitHub
Release and complete signed transport; it does not carry package bytes or grant
trust. Redeven submits the released `release-install-operation.v1` request with
the remote transport and requests post-commit activation for the verified
official release. It observes the durable operation through its generated
start/list/get/watch client. Publisher, plugin, version, hashes,
root delegation, signing ledger, source policy, revocation evidence, host
requirement, and capability pin must all match before ReDevPlugin changes the
registry. Expired or incomplete evidence fails closed without falling back to
external-package admission.

Host restart reconstructs an activation lease only from ReDevPlugin's sealed
registry binding and exact current durable release-trust state. Normal restart
recovery performs no remote release, package, capability, trust-document, or
signing-ledger downloads. Any mismatch in release identity, source, package
hashes, active fingerprint, trust-state digest, root/policy/revocation epochs,
expiry, fence, schema, or clock floor fails closed before a lease or surface is
published. Redeven observes and localizes that result instead of inspecting the
opaque evidence, wrapping trust recovery, retrying a grant, or presenting a
trust failure as permission denial.

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
`0.7.23`, released Rust IPC and WASM ABI, exact product-build descriptor, lease
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
`request_id`, reattaches to the same operation after panel close or transport
loss, and renders the Host's trust fetch, release fetch, capability fetch,
package download, hash, signature/ledger, commit, enable, and reconciliation
phases. Byte progress is shown only when the Host reports bytes; retry attempt
and verified cache-hit details remain explanatory diagnostics rather than
invented percentages. A succeeded operation refreshes inventory and projects
the authoritative enabled or `needs_attention` record; a refresh failure is
shown as a separate recoverable state and never relabeled as an install failure.
Only a confirmed terminal, retryable failure may create a new request. On Env
App startup, only the newest operation for each plugin is eligible for
restoration: active work is always reattached, while a terminal failure remains
visible for 24 hours so a restart does not erase its diagnosis. An older failure,
a failure superseded by a later success, or an expired failure does not return as
stale product state.

Plugin runtime recovery starts from the explicit authenticated plugin-session
ready transition; Env App does not insert a fixed timer between transport
connection and recovery. Plugin Center inventory and navigation remain
interactive while enabled plugins recover. Recovery state is projected by exact
`plugin_instance_id` plus the installed package/manifest/entries identity: a recovering plugin may enter its target Host-owned
single-flight open path, a failed plugin alone remains closed with its typed
reason and explicit idempotent Retry action, and ready plugins remain openable.
No aggregate recovery result becomes a global surface authorization gate.
ReDevPlugin still validates the active lease, trust epochs, revocation, package
identity, permissions, and session binding on every open and RPC boundary. A
successful package update with the same instance id schedules one bounded
catch-up recovery for the new package identity. A typed recovery failure is
sticky for that connected client and cannot trigger an implicit retry; only an
explicit Retry clears the failed-instance marker.

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

Plugin Center cards, detail actions, and the application launcher consume one
`presentPlugin` action projection. A disabled or blocked record never exposes a
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
This concept owns only Redeven's concrete `v0.6.24` assembly.

Manifest surfaces remain `view|command|background` with semantic roles. Activity,
Workbench, window, widget, inventory key, navigation, settings, and product layout
never become manifest fields.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:1` - Opens Host modules and the canonical handler.
- `redeven:internal/redevpluginintegration/owner_scope_recovery.go:1` - Projects released copied-root inspection and exact-plan recovery without editing opaque state.
- `redeven:cmd/redeven/plugin_state_recovery.go:1` - Requires the Local Environment lock and explicit retained-archive confirmation.
- `redeven:desktop/src/main/pluginStateRecovery.ts:1` - Validates the bundled recovery command result and preserves stale-plan outcomes.
- `redeven:internal/redevpluginintegration/external_package_test.go:24` - Exercises upload inspect, confirmed commit, query, disabled state, and staged-artifact cleanup.
- `redeven:spec/redevplugin/artifacts.go:1` - Pins only official public release anchors and the signed v4 capability bundle.
- `redeven:internal/redevpluginintegration/session_adapter.go:340` - Maps read and admin external-package actions to explicit product permissions.
- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Configures the released runtime manager and fixed version.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:1` - Uses generated lifecycle, external-package, and permission-requirement APIs.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginSurfaceContext.ts:1` - Projects semantic shell appearance and locale into the released revisioned surface context.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.ts:1` - Projects exact inventory identities, trust, provenance, grants, and requirements.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1120` - Coordinates exact inventory navigation and placement handoff.
- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx:2150` - Persists and reconciles plugin Workbench widgets.
