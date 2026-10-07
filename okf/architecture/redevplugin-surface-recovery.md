---
type: Architecture Contract
title: Plugin surface recovery and permissions
description: Keep Env App plugin inventory, installation observation, permission finalization, and reconnect recovery on one released client scope.
tags: [architecture, plugins, ui, recovery]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

Env App owns one authenticated plugin client, one shared scope, and one installation observer. ReDevPlugin remains the authority for inventory, Executions, Events, permissions, revocation, and runtime recovery. Closing or reconnecting a panel preserves the exact request identity and authoritative outcome; a product refresh never becomes a second mutation or recovery lifecycle.

# Contract

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

Surface file export follows the released bridge request rather than a
Redeven-specific plugin API. The SDK admits only a recent user action and a
bounded, allowlisted file payload. The placement coordinator supplies one
default browser-download handler, while an explicit caller handler may replace
it. Cancellation is checked before download, and every created object URL is
revoked after its temporary anchor is removed.

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

# Boundaries

The Env App observer may present and localize released snapshots, but it cannot infer retryability, recreate a request, close a plugin slot, or start a worker. Placement and surface geometry remain owned by [Plugin platform integration](plugin-platform-integration.md).

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Constructs released Host modules and product adapters.
- `redeven:internal/redevpluginintegration/session_lifecycle.go:1` - Carries transient connection generation while the Host owns durable teardown.
- `redeven:scripts/check_redevplugin_dependency_boundary.sh:1` - Rejects local wiring and platform duplication.
- `redeven:internal/session/dependency_contract_test.go:1` - Matches downstream coordinates to the released manifest.
