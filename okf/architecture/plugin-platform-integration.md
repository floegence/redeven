---
type: Architecture Contract
title: Plugin platform integration
description: Redeven mounts ReDevPlugin v3.0.24 and adds authenticated host modules, market-backed official releases, external-source policy, localized plugin presentation, product placement, and business adapters.
tags: [architecture, plugins, local-ui, redevplugin]
timestamp: 2026-07-25T00:00:00Z
quality_exception: Cross-domain host integration contract spanning identity, security, runtime, storage, routes, surfaces, and business adapters.
---
# Summary

Redeven integrates ReDevPlugin `v3.0.24` through one Go Host, one canonical HTTP
namespace, one Env App `PluginPlatformClient`, one shared surface scope, and the
released ProcessManager over a verified Redeven-built Linux or Darwin runtime. Redeven
adds authenticated session mapping, public-source admission policy, product
placement, and business adapters; ReDevPlugin retains package, state, protocol,
trust, and runtime ownership. Activity supports Shell-root multi-window placement
and Workbench supports standard projected plugin widgets. Unproven owner,
package, capability, runtime, or surface identity fails closed.

# Contract

## Host construction and routes

`internal/redevpluginintegration` passes one explicit product-selected state root
to ReDevPlugin and constructs the Host with core, official release,
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
channel id and client generation returned by the connect artifact. A successful
Flowersec handshake starts one abortable Local UI readiness wait; it does not
publish the credential. The Agent marks that exact binding ready only after
ReDevPlugin session activation succeeds. The matching readiness response then
promotes the staged credential and starts inventory loading, recovery, and
Execution observation. Reconnect or replacement cancels the old wait, and a late
response cannot publish an older credential. Initializing and closed bindings
cannot reach the plugin platform route.

The released client preserves the HTTP status for rejected non-JSON responses;
only a successful response with malformed JSON is reported as an invalid JSON
contract. Redeven consumes that structured transport fact and does not infer a
status by parsing error text.

The Host owns durable session-scope teardown identity, phase, continuation,
terminal claim, migration, and reconciliation in its control database. Redeven's
`PluginSessionGeneration` is transient connection identity only; it cannot become
a second durable lifecycle owner. Shutdown closes Local UI admission and hijacked
transports before canceling Agent sessions, waits for request leases and session
handlers, and then invokes the released idempotent Host teardown path.

## Package sources and lifecycle

Production obtains catalog entries from the validated latest-only market
snapshot. A snapshot may identify an immutable release and signed transport,
but it does not carry package bytes or grant trust. Redeven opens a concise
review from signed presentation, source, version, and declared permissions.
Review performs no package parsing, signature verification, runtime preflight,
or lifecycle work. After confirmation, Redeven calls the released Host install
API and observes the Host-owned Execution and ordered Events. Publisher,
plugin, version, hashes, signatures, revocation evidence, source policy, and
Host requirements must match before ReDevPlugin changes the registry. Invalid,
revoked, or incomplete evidence fails closed.
Submission response loss is reconciled with the same request id and exact market
digests. A declaration mismatch refreshes the market before a new attempt.
Confirmed retained-data deletion treats an
already-absent binding as success and reconciles an unknown mutation outcome
against the exact generation and binding revision before reinstalling.
ReDevPlugin `v3.0.24` also preserves the deleted instance's durable revoke-epoch
floor across both retained-data and delete-data reinstalls. Previously issued
credentials therefore remain revoked, while the newly installed instance can
open surfaces with credentials minted at the current floor.

ReDevPlugin starts and health-checks the runtime and prewarms the exact worker
module after fresh install, update, downgrade, enable, and startup recovery.
Host restart and explicit retry use the Host-owned recovery snapshot and
`recoverEnabled` path. Redeven observes and localizes the authoritative result;
it does not scan the registry to start workers, persist release trust,
activation evidence, recovery identities, or a second grant/trust state machine.

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
after explicit confirmation and remain manual-update-only. Every successful
fresh install is persisted as enabled in the same Host transaction. Confirmation
does not silently grant permissions: missing or policy-blocked requirements are
projected as product attention, and the affected open or capability call returns
`permission_required` until the user grants access. Invalid or revoked
signatures are blocked. A later update remains bound to the installed instance and current
management revision. GitHub updates may reuse the stored public repository
identity; package-URL updates require the administrator to enter the URL again,
and upload updates require a new file selection. Redeven never reconstructs a
reusable URL from redacted provenance origin/path fields. A GitHub source without
an administrator-entered tag resolves the latest eligible Release on each new
inspection; the previously resolved release tag is evidence, not a new durable
user pin.

## Runtime boundary

The runtime module binds the canonical sibling executable, target, ReDevPlugin
`v3.0.24`, runtime-internal IPC and WASM ABI contracts, exact product-build descriptor, lease
replay storage, and released limits. Linux and Darwin runtime bytes are built
with Rust 1.88.0 from the attested release manifest and travel with SBOM,
provenance, notices, and signature evidence. Linux admission requires the
released static-PIE shape; Darwin admission requires the released native Mach-O
target, and release bytes are Developer ID signed before the product digest and
Sigstore evidence are written. The expected binary digest comes from the product
release marker; field binary bytes are never hashed and accepted as their own
trust anchor. Missing, non-canonical, wrong-target, unsigned, or wrong-hash
runtime evidence blocks startup.

Native Containers is intentionally outside the plugin runtime and does not
register a capability adapter. Its Local API, permissions, operation lifecycle,
and product surfaces are owned by
[Native container resources](container-resources-capability.md).

## Env App inventory and permissions

Env App owns one authenticated fetch adapter, one released client, one shared
scope, and one placement coordinator. Generated DTOs drive lifecycle,
external-package, generic permission-requirement, and interaction calls. Every
mutation carries its current management and applicable policy/revoke revisions;
committed and unknown management outcomes rely on Host revocation followed by
the SDK's scope teardown, then refresh state without a second slot-close path or
blind mutation retry.

Official installation is product-observable but platform-owned. The Shell keeps
one coordinator keyed by `plugin_instance_id`; it is the only owner of first
observation, reconnect, startup recovery, and completion. It preserves the
original `request_id`, reattaches to the same Execution after panel close or
transport loss, and decodes only the released `download`, `verify`, `install`,
and `enable` progress contract. Byte progress is shown only when the Host reports
bytes; internal verification diagnostics never create product UI stages. A
terminal Event advances into one finalization read that is retried independently,
so a lost Execution response cannot strand the observer after its event cursor.
A succeeded operation enters one `finalizing` state. Redeven refreshes inventory
once, preflights the complete required permission set, grants permissions in
order by passing each mutation response's revisions into the next mutation, and
refreshes inventory once more only when it made a grant. It never performs a
full inventory refresh after an individual grant. The final projection must be
enabled and openable before the operation leaves `finalizing`. A concurrent
disable, revoke, or revision conflict supersedes automatic finalization; policy
failure is an activation failure. A refresh failure is separately recoverable
and retries finalization without reinstalling. Only the target plugin is locked
while the rest of Plugin Center remains usable.
Only the terminal Event's released `retryable` fact may permit a new request;
Redeven does not infer it from an error code. An uncertain submission replays the
same reviewed command and request id, while a confirmed retry starts a new
request. A structured submission error with `committed` or `unknown` mutation
outcome also replays the same request; only `not_committed` returns to review.
On Env App startup, durable observation waits for the authoritative inventory
projection, then only the newest Execution for each plugin is eligible for
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

Surface startup has one terminal-error path. The SDK `onError` callback and the
opening promise share the first reported error, while Slot state changes do not
create a second user-visible failure source. During opening, Redeven records the
error without aborting the SDK lease and lets ReDevPlugin finish authoritative
revocation and settlement. Local cleanup failures are reported only through the
retirement diagnostic sink and cannot replace the visible terminal error. After
ready, a terminal runtime error still retires the exact slot; explicit close and
host-driven invalidation keep their separate lifecycle responsibilities.

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
An installed launch target is projected only from a Host-verified primary view
surface in the active manifest; catalog metadata never supplies a fallback
surface id.

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

Workbench plugin drag placement consumes Floe Webapp's released canvas
placement result directly. Floe owns the standard-size preview, zoom and pan
projection, edge auto-pan, final pointer snapshot, and world-coordinate
resolution. Redeven owns only the target-to-widget binding. The first placement
for an exact plugin instance and surface opens one `redeven.plugin` widget at
that world center without a second client-coordinate conversion or viewport-
centering step. A later drag or pinned-Dock activation reuses, activates, and
centers that same widget instead of creating a duplicate. Different exact
plugin targets may coexist. There is no plugin-specific Ghost or fallback drag
state.

Opening the same placement reactivates it. Moving between Activity and Workbench,
replacing a Workbench revision, or deleting a widget globally serializes the
transition and awaits exact old-slot close before persisting or opening the new
placement. The new target always receives a fresh slot lease and iframe. A lost
close response is reconciled by the released exact-surface contract; local
disposal alone is not revocation evidence.

# Boundaries

Canonical ownership is defined by [ReDevPlugin host integration boundary](redevplugin-boundary.md).
This concept owns only Redeven's concrete `v3.0.24` assembly.

Manifest surfaces remain `view|command|background` with semantic roles. Activity,
Workbench, window, widget, inventory key, navigation, settings, and product layout
never become manifest fields.

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:1` - Opens Host modules and the canonical handler.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ExternalPluginInstallDialog.test.tsx:1` - Exercises inspect, explicit confirmation, enabled Host install, and permission-attention presentation.
- `redeven:spec/redevplugin/artifacts.go:1` - Pins official package keys and loads the generated known v4 capability contract.
- `redeven:internal/redevpluginintegration/session_adapter.go:340` - Maps read and admin external-package actions to explicit product permissions.
- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Configures the released runtime manager and fixed version.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginApi.ts:1` - Uses generated lifecycle, external-package, and permission-requirement APIs.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginSurfaceContext.ts:1` - Projects semantic shell appearance and locale into the released revisioned surface context.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginInventoryProjection.ts:1` - Projects exact inventory identities, trust, provenance, grants, and requirements.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx:1120` - Coordinates exact inventory navigation and placement handoff.
- `redeven:internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx:2150` - Persists and reconciles plugin Workbench widgets.
