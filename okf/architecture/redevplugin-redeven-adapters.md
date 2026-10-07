---
type: Architecture Boundary
title: ReDevPlugin Redeven adapters
description: Keep Redeven-specific host modules, external package policy, and surface projection separate from ReDevPlugin platform mechanics.
tags: [architecture, plugins, adapters, ui]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

Redeven owns only the adapters that bind authenticated product sessions, source policy, business capabilities, and Activity or Workbench placement to released ReDevPlugin contracts. ReDevPlugin remains the authority for host protocol, package trust, runtime execution, and platform state. Adapter failures stop at the product boundary and never create copied platform state or implicit grants.

# Contract

## Host modules and external packages

Redeven constructs the released Host with explicit core, official-release,
runtime, connectivity, secrets, capability, and external-package modules.
ReDevPlugin-owned stores remain opaque below the selected control root. Redeven
supplies session, authorization, web-security, trust,
official release-source, observability, secret, external source, and business
adapters; it never edits registry, inspection, token, lease,
revoke-epoch, or plugin-data state directly.

Redeven supplies the exact already-held Local Environment runtime lock and its
runtime instance id to the released session-maintenance adapter. ReDevPlugin owns
the durable phase, teardown identity, continuation, terminal claim, migration,
and reconciliation contract. Redeven owns only authenticated channel generation,
Local UI access-session binding, transport admission leases, and shutdown
ordering around that adapter. Logout and expiry may select exact product
connections and generations, but they cannot invent a lifecycle phase, delete a
durable fence, or widen one access session into another owner scope.

Redeven exposes validated HTTPS, GitHub Release, and bounded local
`.redevplugin` sources behind its authenticated admin gate, then forwards
`inspect -> explicit confirmation -> install` to the Host. ReDevPlugin owns the
opaque inspection id, provenance, signature and update assessment, exact
owner/session and byte/hash binding, and atomic installation; inspection creates
no durable record or receipt. Unsigned or unknown-signer packages may cross only
after confirmation and remain manual-update-only. Missing grants project product
attention and make only the affected call return `permission_required`; invalid
or revoked signatures block install and execution. The official signed-release
module remains the stricter release-ref path.

## Surfaces and interaction ownership

The product Shell owns one released `PluginPlatformClient`, authenticated
transport, and shared surface scope. Activity places each fresh SDK slot in a
Shell-root floating window. Workbench persists the target in a standard projected
`redeven.plugin` widget and wraps the SDK element with Redeven wheel, selection,
action, activation, focus, and floating-layer policy.

Interaction observations arrive only through ReDevPlugin's source/port-bound
surface channel and remain tied to the current frame generation and opaque
surface. Redeven uses them for host placement behavior, never as identity,
authorization, or permission evidence. Each mode owns independent slots; a current-mode open never closes another mode. Saved Workbench bindings belong to Redeven layout transactions and survive runtime retirement. External pre-update cleanup awaits exact-slot closure before the platform mutation. Lost close responses reconcile through the released idempotent
exact-surface contract and must not widen into session-scope revocation or affect
sibling surfaces. Management mutations are different: the released Host revokes
affected authority, then the SDK tears down the shared scope for committed or
unknown outcomes. Redeven must not issue a second close against those disposed
slots or treat local disposal as the server-side revoke.

The `v3.0.33` bridge delivers `keydown` and `keyup` from the focused plugin
Surface, including canvas, editable, control, and surface targets. Exact
declarative bindings are evaluated synchronously inside the sandbox when a
plugin must prevent a matching browser default; composition input never
satisfies a submit binding. This input boundary does not observe other
Surfaces, windows, or system-global keyboard events, and Redeven must not add a
second keyboard forwarder or interception path.

Button click actions preserve the owning button's value when the pointer lands
on a nested label or icon. ReDevPlugin owns this DOM dispatch behavior, including
keyboard activation; Redeven consumes the released fix without intercepting or
reconstructing plugin actions.

Retained hidden surfaces keep their existing iframe and canvas instances.
ReDevPlugin measures canvas CSS layout independently from backing pixels and
waits for nonzero layout before opening or resizing a canvas. Hidden canvases
retain their last valid pixel reservation, and the existing dimension and total
pixel limits remain enforced. Redeven supplies placement visibility only; it
does not infer canvas sizes or compensate for device pixel ratio.

The same bridge accepts a file export only within the bounded user-action
window and validates its filename, media type, and byte limit before delivering
it to the host. The plugin owns the exported content and filename. Redeven's
default handler maps that validated request to one browser `Blob` download,
checks cancellation before the side effect, and removes the temporary anchor
and object URL immediately afterward. It does not upload the bytes, persist a
copy, or create a plugin-specific export path.

When a surface fails during startup, ReDevPlugin owns terminal settlement and
exact revocation. Redeven preserves the first SDK terminal error across
`onError`, opening-promise rejection, and local cleanup, and does not abort the
opening lease merely because that error was observed. Cleanup failure remains
diagnostic evidence and never becomes the product-facing cause.

Plugin Center cards, details, launchers, and placement commands consume the
Host-projected `action_state` as their only lifecycle action authority. Redeven
does not recompute `can_open` from trust, grants, policy, or recovery flags. A
recovery presentation may explain or retry the Host snapshot, but it is not a
second open gate and owns no catch-up identity state machine.

# Boundaries

These adapters map product identity and presentation into released ReDevPlugin APIs. They do not parse packages, issue platform tokens, own plugin lifecycle, or reinterpret platform trust. Package and runtime ownership remains in [ReDevPlugin host integration boundary](redevplugin-boundary.md) and [Plugin package and runtime lifecycle](redevplugin-package-lifecycle.md).

# Evidence

- `redeven:internal/redevpluginintegration/integration.go:240` - Constructs released Host modules and product adapters.
- `redeven:internal/redevpluginintegration/session_lifecycle.go:1` - Carries transient connection generation while Host owns durable teardown.
- `redeven:internal/redevpluginintegration/trust_adapter.go:1` - Delegates package signature and freshness assessment upstream.
- `redeven:internal/redevpluginintegration/runtime_module.go:1` - Admits the released worker runtime without copying its execution model.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginPlatform.ts:1` - Owns the released client, transport, scope, and placement adapter.
- `redeven:internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx:300` - Registers the projected plugin widget.
