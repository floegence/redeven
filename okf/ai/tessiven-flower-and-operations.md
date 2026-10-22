---
type: AI Product Contract
title: Tessiven Flower and operations
description: Generate canvas versions and route service actions through their original owners.
tags: [ai, tessiven, flower]
timestamp: 2026-10-11T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower maps authorized code, configuration, and connected Runtime facts into
Tessiven versions through the `redeven-tessiven` system skill. Flower owns canvas
content editing as a core workflow. Resource actions
remain owned by the existing Managed Services and Containers managers. A
transport failure after a mutation is dispatched is terminal with an unknown
outcome, so the user must inspect the original manager before trying again.

# Contract

- Tessiven tools read the canonical schema, list/read/validate versions, save a   complete new version, inspect explicit targets, and execute one exact bound   instance when the existing permission and approval checks allow it. - Read-only inspection of a missing, non-current, or unauthorized Runtime   returns structured `unavailable` state without a binding. Unknown   mutation outcomes disable another mutation until the original manager has   been inspected.

# Boundaries

Flower and the UI call the same Tessiven service; neither writes its database directly. Explicit connection uses the original native owner; missing authority never substitutes a local target. External and unmanaged resources support inspection and explanation only.

# Evidence

- `internal/tessiven/context_test.go` - Canonical host and instance selections retain logical membership.

- `internal/ai/system_skills/redeven-tessiven/SKILL.md`

- `internal/ai/tessiven_tools.go`
