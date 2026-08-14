---
type: Architecture Contract
title: Containers operation observation
description: Keep endpoint-bound Containers mutations locked through terminal observation and authoritative reconciliation.
tags: [architecture, plugins, containers, operations]
timestamp: 2026-07-29T00:00:00Z
---
# Summary

Every Containers mutation binds one engine, opaque endpoint, resource identity,
ReDevPlugin operation handle, and local observation record. The resource stays
locked until terminal observation and fresh authoritative inventory prove the
result. Lost submissions, stale plans, unavailable engines, and failed
reconciliation are never replayed or shown as success. Production uses the
signed Containers `4.4.4` release after complete ReDevPlugin package and
publication evidence has been verified.

# Contract

## Resource-local lifecycle

Operation keys include engine, endpoint ID, resource kind, and canonical
identity. Compose Project and Pod operations use their canonical project or Pod
ID; creation uses the stable requested name. One key can submit only one
mutation at a time, while different keys may proceed concurrently. The record
retains its Host handle, visible Host-reported status, optional revisioned
progress, reconciliation function, and one local abort controller until exact
reconciliation releases it.

The generated client returns a released ReDevPlugin operation handle. The
surface uses that handle's bounded `wait` for terminal authority and `snapshot`
for revisioned progress. Both are local observation of Host authority, not a
second operation protocol. Completed, failed, canceled, and orphaned terminal
states trigger fresh endpoint-bound inventory. Controls unlock only after the
matching authoritative inventory is non-partial and proves the desired state,
absence, stable creation identity, or a fully unchanged failed attempt. A
failed reconciliation pauses observation and exposes an explicit resume action
on the same handle.

Surface disposal aborts local wait and snapshot observation but never calls
operation cancel. Closing Activity, Workbench, an inspector, or a stream is not
authority to cancel Host work. User cancellation is separate: a confirmed
request keeps terminal observation active, a proven `not_committed` response
may be retried, and an unknown or lost response disables repeated cancellation
while observation continues.

## Refresh and stream fencing

Every inventory refresh captures engine, endpoint, and a monotonic generation.
Starting a refresh first marks every resource inventory non-authoritative. A
superseded response cannot publish data or release a resource lock. Existing
arrays may be shown as explicitly stale during refresh failure, but stale,
partial, unavailable, or wrong-endpoint data cannot authorize destructive work
or satisfy reconciliation.

Changing engine or endpoint closes the active container detail stream, clears
endpoint-specific detail and statistics state, and fences older reads. It does
not cancel Host operations. The operation drawer persists while the surface
remains open and keeps endpoint identity visible through its resource target.

Container Usage and Logs streams bind exact engine, endpoint, and container ID.
Only real Host stats are shown; elapsed time never generates synthetic metrics.
Replacing or closing detail cancels the old stream before a new stream may
publish. Surface teardown uses the released stream lifecycle and cannot leave a
detached Redeven polling path.

## Unknown and partial outcomes

A submission proven `not_committed` removes its local lock and permits a new
attempt. A committed, unknown, or missing mutation outcome retains a visible
uncertain record and blocks duplicate work in that surface. Refresh alone cannot
prove that a lost operation handle reached terminal state and therefore cannot
clear the lock.

Container lifecycle reconciliation compares the exact canonical ID and desired
state. Container, volume, Pod, and image creation use stable name or reference
identity. Removal proves absence. Compose and Pod lifecycle reload their exact
workspace. Image and volume prune reconcile every preflight identity. Partial
removal, changed references, missing terminal inventory, or ambiguous restart
keeps the operation locked. The UI does not claim durable cross-surface recovery
for a handle that was never received.

Progress presentation uses only Host-reported phases and completed or total
units. It never draws an elapsed-time percentage or decorative progress line.
Operation status uses accessible live regions; Cancel and Resume are real
keyboard-accessible controls with pointer affordance and touch targets of at
least 44 px on touch layouts.

## Candidate application behavior

The v4 candidate opens on an operation-oriented Overview and provides endpoint-
scoped Containers, Images, Volumes, Docker Projects, and Podman Pods
workspaces. Docker and Podman specializations are mutually exclusive. Dense
resource tables expose one state-appropriate primary action and one menu;
secondary and destructive actions remain in the menu. No UI batch action exists
without an exact capability contract.

Desktop uses a persistent 168 px navigation and side inspector. Intermediate
widths use a 56 px navigation. Mobile uses a top resource selector and a
full-screen detail drill-in. Closing detail returns focus to the resource row.
Menus remain available to pointer and keyboard users, including Context Menu
and Shift+F10 behavior supplied by the validated native control path. The
surface uses semantic appearance tokens, supports forced colors, removes motion
under reduced-motion preference, and never moves table geometry on hover.

Create Container, Create Volume, and Create Pod use structured forms. Common
fields appear first and advanced container settings are grouped by meaning.
Preflight review prioritizes action, exact target, operation impact, and risk;
technical evidence is secondary. The exact-name confirmation sits beside the
danger summary, and a fixed footer keeps the final action visible without
requiring the user to scroll to the end. Submission disables closing and repeat
submission until the Host outcome is known.

The candidate has independent `en-US`, `zh-CN`, `zh-TW`, `ja-JP`, `ko-KR`,
`de-DE`, `fr-FR`, `es-ES`, `pt-BR`, and `ru-RU` catalogs. Locale, direction,
theme, and appearance revisions update the existing iframe. Search uses NFKC
normalization, and known status, progress, method, and risk identifiers map to
localized product copy. Unknown Host text stays literal instead of being
guessed.

## Release trust

Containers source, tests, manifest, icon, and stable distribution are owned by
`floegence/redeven-official-plugins`. Redeven consumes only the complete signed
`4.4.4` release selected by the frozen latest-only market snapshot. ReDevPlugin
verifies package signing, root delegation, source policy, revocation, release
metadata, and package-set evidence before any
registry mutation. Unsigned, partial, or locally built bytes cannot substitute
for those materials.

# Boundaries

ReDevPlugin owns operation handles, wait, snapshot, cancel, mutation outcome,
surface audience, and stream lifecycle. Redeven owns endpoint-aware application
state, concrete Docker and Podman behavior, resource projection, and exact
inventory reconciliation. The UI does not copy an operation store or polling
route, and ReDevPlugin does not import Redeven container semantics. Canonical
package and integration ownership remains in [Plugin platform integration](plugin-platform-integration.md).

# Evidence

- `redeven:internal/pluginmarket/service.go` - Freezes the latest-only production release selection and validated transport.
- `redeven:internal/redevpluginintegration/release_module.go` - Installs the complete signed GitHub Release transport through ReDevPlugin.
- `redeven:scripts/check_plugin_integration.sh` - Routes final ReDevPlugin integration validation through the published package-set and capability gates.
