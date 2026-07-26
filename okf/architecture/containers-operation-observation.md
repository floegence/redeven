---
type: Architecture Contract
title: Containers operation observation
description: Observe each Containers mutation to terminal state, reconcile authoritative inventory, and keep unsigned candidate artifacts outside official release trust.
tags: [architecture, plugins, containers, operations]
timestamp: 2026-07-26T00:00:00Z
---
# Summary

The production Containers `2.0.0` release remains the signed, trust-closed
artifact. The `2.1.0` candidate is historical and immutable. The current
repository UI candidate is `2.2.0`, built against the released ReDevPlugin
`0.6.19` operation handles through manifest v6 and `plugin-ui-v6`; it is not an
official catalog release. Every Docker or Podman container owns an independent
mutation generation. The same resource remains locked until terminal observation
and authoritative inventory reconciliation, while unrelated resources remain
usable. Unknown mutation outcomes are never replayed or presented as success.

# Contract

## Resource-local lifecycle

The operation key is the exact engine and container id. One key may submit only
one start, stop, restart, or remove mutation at a time; different keys proceed
concurrently. A monotonically increasing generation guards every state update,
observation controller, operation handle, and completion so an older async result
cannot overwrite a replacement generation. Logs bind their own engine, container,
and generation so an old engine stream cannot write into a newer view.

The generated capability client returns the released operation handle. The UI
uses its bounded `wait` method and does not implement a parallel snapshot polling
protocol. Completed, failed, canceled, and orphaned terminal states all trigger a
fresh capability `list` call. Conflicting controls unlock only after that
authoritative call succeeds. Failed reconciliation pauses observation and offers
an explicit resume action; resuming the terminal handle retries reconciliation.

Surface disposal aborts only local `wait` observation. It never calls operation
`cancel`, because closing a view is not authority to cancel Host work. A user
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

Operation status uses accessible live regions without inventing percentage
progress. Cancel and resume controls remain keyboard-accessible, interactive
controls retain pointer affordance, touch targets remain at least 40-44 pixels,
and narrow layouts collapse actions and operation details without hiding the
resource-local state. Operations whose resource disappears from inventory remain
visible in a dedicated reconciliation section.

## Candidate UI and release trust

The 2.2.0 candidate presents a dense, responsive resource list with client-side
search over the exact v2 wire fields (container name, id, image, state, and
published ports). A selected container opens a modal inspector containing only
state, id, image/digest, created time, and published ports; it must not fabricate
mounts, devices, runtime metadata, image history, or volumes that the active
contract does not expose. Semantic theme variables follow the system light/dark
preference for candidate preview, with reduced-motion behavior and mobile
controls at least 44px. Exact Redeven preset and locale adaptation still require
released host-neutral ReDevPlugin context. Search and inspection are presentation
state only and do not alter operation identity, permissions, or reconciliation
locks.

`spec/redevplugin/candidate-containers-plugin/2.2.0/plugin.redevplugin` is an
unsigned build candidate. The local integration gate installs exact npm
dependencies, runs focused state and bundled-client tests, rebuilds the source,
packages it with the released ReDevPlugin `v0.6.19` CLI, compares exact bytes,
validates manifest v6, version `2.2.0`, minimum runtime `0.6.19`, and
`plugin-ui-v6`, and rejects any package signature entry.

Production catalog installation remains pinned to the signed, trust-closed
Containers `2.0.0` release. The candidate does not change stable/latest catalog
metadata, generated release refs, signed release artifacts, or trust roots. A real
`2.2.0` official release requires external signing keys plus fresh root, policy,
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

- `redeven:plugins/official/containers/src/main.ts:1` - Runs per-resource operation handles through terminal reconciliation and accessible UI states.
- `redeven:plugins/official/containers/src/operation-state.ts:1` - Owns exact engine-container generations and rejects stale updates.
- `redeven:plugins/official/containers/src/operation-policy.ts:1` - Separates retryable not-committed outcomes from uncertain mutations and cancellations.
- `redeven:plugins/official/containers/test/main.integration.test.mjs:1` - Proves resource concurrency, unknown-outcome locking, and dispose-without-cancel behavior.
- `redeven:scripts/check_containers_plugin_candidate.sh:1` - Rebuilds and validates the unsigned candidate without treating it as a signed release.
- `redeven:spec/redevplugin/candidate-containers-plugin/2.2.0/plugin.redevplugin:0` - Carries the deterministic unsigned candidate bytes.
