---
type: Architecture Contract
title: Containers operation observation
description: Observe each Containers mutation to terminal state, reconcile authoritative inventory, and keep unsigned candidate artifacts outside official release trust.
tags: [architecture, plugins, containers, operations]
timestamp: 2026-07-26T00:00:00Z
---
# Summary

The production Containers `2.0.0` release remains the signed, trust-closed
artifact. Earlier candidates remain historical and immutable. The current
repository UI candidate is `3.0.0`, built against the released ReDevPlugin
`0.6.20` operation handles and surface context through manifest v7 and
`plugin-ui-v7`; it is not an
official catalog release. Every exact Docker or Podman resource mutation owns one
operation record and resource-local lock. The same resource remains locked until
terminal observation and authoritative inventory reconciliation, while unrelated
resources remain usable. Unknown mutation outcomes are never replayed or presented
as success.

# Contract

## Resource-local lifecycle

The operation key binds the exact engine, resource kind, and canonical identity.
One key keeps one operation record and may submit only one mutation at a time;
different keys proceed concurrently. The record retains its Host handle and one
local observation abort controller until exact reconciliation releases the lock.
Inventory refresh uses a separate monotonic generation so a superseded refresh
cannot publish stale evidence. The active detail stream retains its exact engine
and container identity, and replacement closes that stream before a new detail
stream may publish logs.

The generated capability client returns the released operation handle. The UI
uses its bounded `wait` method for terminal authority and the same SDK handle's
revisioned `snapshot` method for visible Host-reported progress. Both observations
share one surface-local abort controller; this is SDK observation, not a second
protocol or state authority. Completed, failed, canceled, and orphaned terminal
states all trigger a fresh capability `list` call. Conflicting controls unlock
only after that authoritative call succeeds. Failed reconciliation pauses
observation and offers an explicit resume action; resuming the same handle retries
terminal observation and exact reconciliation.

Surface disposal aborts local `wait` and `snapshot` observation. It never calls
operation `cancel`, because closing a view is not authority to cancel Host work. A user
cancel action remains distinct: a confirmed response leaves observation running
until terminal status, a proven `not_committed` response may be retried, and an
unknown or lost response disables repeated cancel while terminal observation
continues.

## Unknown mutation outcomes

A submission proven `not_committed` removes the resource lock and permits a new
attempt. Committed, unknown, or missing mutation outcome retains a visible
submission-uncertain state and prevents duplicate mutations in that view. A list
refresh may show current resource state but cannot prove that a lost operation
handle reached terminal state, so refresh never clears this lock or fabricates
exactly-once behavior. Reopening a disposed surface creates new in-memory UI state;
the product does not claim cross-surface recovery for a handle that was never
received.

Operation status uses accessible live regions and only displays phase or unit
progress reported by the Host-owned revisioned operation snapshot. It never
invents progress from elapsed time. Cancel and resume controls remain keyboard-accessible, interactive
controls retain pointer affordance, touch targets remain at least 40-44 pixels,
and narrow layouts collapse actions and operation details without hiding the
resource-local state. Operations whose resource disappears from inventory remain
visible in a dedicated reconciliation section.

## Candidate UI and release trust

The 3.0.0 candidate presents dense, responsive Containers, Images, and Volumes
views with per-view search, resource inspection, creation, lifecycle actions,
statistics, history, tagging, removal, and pruning from the exact unsigned v3
candidate contract. Destructive and plan-bound actions show reviewed preflight
facts, while ReDevPlugin independently reruns that preflight and binds its exact
Host-owned `plan_hash` before execution. The displayed `plan_digest` never enters
the operation request. Prune previews instead return their normalized
`resource_identities`; execution submits and hashes that exact non-empty set,
revalidates every member before mutation, and issues one identity-specific image
or volume removal invocation at a time. The adapter then compares every planned
identity with authoritative terminal inventory. A partial removal or unavailable
inventory reports an unknown mutation outcome so the surface refreshes and does
not retry the batch blindly. Semantic theme variables, locale, and direction come from
the released revisioned surface context and update the same iframe without a
remount. The candidate ships independent `en-US`, `zh-CN`, `zh-TW`, `ja-JP`,
`ko-KR`, `de-DE`, `fr-FR`, `es-ES`, `pt-BR`, and `ru-RU` dictionaries. Known
progress phases, plan methods, and stable risk ids resolve through those
dictionaries; unknown Host text remains literal instead of being guessed.
Reduced-motion behavior and mobile controls remain first-class. Search and
inspection are presentation state only and do not alter operation identity,
permissions, or reconciliation locks.

Every candidate mutation keeps its resource-local operation lock through a fresh
authoritative inventory refresh and exact desired-state reconciliation. Container
state changes reconcile the exact container id and expected state; create, pull,
and tag operations reconcile a stable name or reference; removal reconciles
absence; and prune reconciles every preflight identity. Each refresh invalidates
all per-view freshness flags before any asynchronous work, and only a successfully
reloaded, non-partial matching inventory can release the lock. A failed,
unavailable, or superseded refresh must not treat retained UI arrays as current
evidence. An unchanged failed terminal result may release only where the exact
before/after state proves no mutation; ambiguous restart and partial outcomes stay
locked for reconciliation.

Create Container and Create Volume use structured, repeatable command,
environment, port, mount, device, and driver-option rows instead of private
textarea grammars. Stable row keys preserve neighboring input while rows are
added or removed. Container and volume creation require stable names so terminal
results can be reconciled exactly. Progressive disclosure keeps network,
resource, and security settings available without making the primary creation
path visually dense.

`spec/redevplugin/candidate-containers-plugin/3.0.0/plugin.redevplugin` is an
unsigned build candidate. The local integration gate installs exact npm
dependencies, runs focused state and bundled-client tests, rebuilds the source,
packages it with the released ReDevPlugin `v0.6.20` CLI, compares exact bytes,
validates manifest v7, version `3.0.0`, minimum runtime `0.6.20`, and
`plugin-ui-v7`, and rejects any package signature entry.

Production catalog installation remains pinned to the signed, trust-closed
Containers `2.0.0` release. The candidate does not change stable/latest catalog
metadata, generated release refs, signed release artifacts, or trust roots. The
v3 capability candidate intentionally has no signature or activatable pin, so
Host registration fails closed. A real `3.0.0` official release requires external signing keys plus fresh root, policy,
revocation, ledger, release metadata, and package signature evidence. Candidate
bytes never become official, verified, auto-update eligible, or stable by their
presence in this repository.

# Boundaries

ReDevPlugin owns operation handle, snapshot, wait, cancel, surface audience, and
mutation-outcome contracts. Redeven owns this Containers UI state and the concrete
Docker/Podman capability adapter. The UI does not copy an operation store or
polling route from ReDevPlugin, and ReDevPlugin does not import Redeven container
semantics. Canonical integration and package-source ownership remain in
[Plugin platform integration](plugin-platform-integration.md).

# Evidence

- `redeven:plugins/official/containers/src/main.ts:649` - Keeps one exact resource operation record, SDK handle, local observation controller, and reconciliation function through terminal reconciliation and accessible UI states until authoritative evidence releases the lock.
- `redeven:plugins/official/containers/src/i18n.ts:1` - Owns complete independent candidate dictionaries, stable Host message mappings, and locale fallback.
- `redeven:plugins/official/containers/src/operation-policy.ts:1` - Separates retryable not-committed outcomes from uncertain mutations and cancellations.
- `redeven:plugins/official/containers/test/main.integration.test.mjs:1` - Proves structured creation, resource concurrency, partial-reference safety, stale-inventory fail-closed behavior, exact prune reconciliation, unknown-outcome locking, and dispose-without-cancel behavior.
- `redeven:scripts/check_containers_plugin_candidate.sh:1` - Rebuilds and validates the unsigned candidate without treating it as a signed release.
- `redeven:spec/redevplugin/candidate-containers-plugin/3.0.0/plugin.redevplugin:0` - Carries the deterministic unsigned candidate bytes.
