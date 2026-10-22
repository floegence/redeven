---
type: AI Tool Contract
title: Computer target selection across threads
description: Resolve logical targets without side effects and preserve each authorized thread selection across turns and restart.
tags: [ai, computer-use, targets, permissions]
timestamp: 2026-10-21T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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

A changed title/URL requires fresh discovery rather than a silent substitute.

## Default work and explicit switching
For `current`, the Runtime reads the thread's `computer_target_id`. An existing selection must still resolve to that exact resource.

Empty, failed and pending inventory reads retain cancellation, return and close controls.

## Persistence and fork
The migrated product store remains the only selection store.

A lost task page fails until an authorized candidate is selected. Deleting product settings removes the selection and grants; a later bind never recreates a deleted thread.

# Boundaries

Task access contains exact allowed origins, application identities and temporary foreground permission. The script cannot submit its own grant fields.

Persisted preference or grants alone cannot prove readiness, foreground safety or platform qualification.

# Evidence

- `redeven:internal/ai/computer_runtime.go` - read-only resolution and store binding.

- `redeven:internal/ai/run.go` - authorized selection before adapter dispatch.

- `redeven:internal/ai/target_registry.go` - deterministic identity resolution.
