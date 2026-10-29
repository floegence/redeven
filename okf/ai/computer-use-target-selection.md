---
type: AI Tool Contract
title: Computer target selection across threads
tags: [ai, computer-use, targets, permissions]
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

The Computer Use Runtime owns discovery and selection over Redeven product
settings. Users describe work; Flower finds the browser page or application
window. The current selection is a working position, not a requirement to bind
resources in settings. Candidates never grant access. Stale, disconnected or
occupied resources fail explicitly without changing the previous selection.

# Contract

## Discovery and selection
`computer.targets` lists browser profiles/pages and application windows without a preselected target. Explicit system/personal-browser tasks use `system`, which excludes managed and native window candidates and never starts a managed profile.

Set application to a name or bundle ID for bounded installed-app discovery,
including apps not running. Discovery never launches. Selecting an application
candidate opens/restores that exact catalog entry; one accessible window is
selected, while zero or multiple windows return launch facts and window candidates.
App and foreground grants, current target ownership and private pause boundaries
are checked before launch. Launch uncertainty never authorizes automatic replay.

A changed title/URL requires fresh discovery rather than a silent substitute.

## Default work and explicit switching
For `current`, the Runtime reads the thread's `computer_target_id`. An existing selection must still resolve to that exact resource.

Empty, failed and pending inventory reads retain cancellation, return and close controls.

## Persistence and fork
The migrated product store remains the only selection store.

A lost task page fails until an authorized candidate is selected. Deleting product settings removes the selection and grants; a later bind never recreates a deleted thread.

## Binding contract and observation identity
Selection returns version 2 with exact backend availability and the shared core
script guide and one bounded initial observation through the normal runtime gate.
Observation failure retains selected:true and needs_observation; private pauses
retain selection without leaking content. Confirmed app opening remains
action_executed:true. ui.help discloses read, visual and download details on demand.
The earlier verbose capability fields are superseded by this model-facing guide;
there are no product consumers of those fields. It is not a new registry or authorization source. Native adapters reject
browser-only query, attribute and image-coordinate operations before dispatch.

discovery_name is the discovery label. target_name comes from this call's
observed title, or the stable target ID if no title was observed;
observation_status distinguishes current observation from no new observation.
A failed or zero-operation script must not present an old about:blank label as a
current page. Flower activity shows localized validation/preparation/confirmed or
unknown-effect guidance from returned facts. These facts do not create retry authority.

# Boundaries

Task access contains exact allowed origins, application identities and temporary foreground permission. The script cannot submit its own grant fields.

Persisted preference or grants alone cannot prove readiness, foreground safety or platform qualification.

# Evidence

- `redeven:internal/ai/computer_runtime.go` - read-only resolution and store binding.

- `redeven:internal/ai/target_registry.go` - deterministic identity resolution.
