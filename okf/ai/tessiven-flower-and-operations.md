---
type: AI Product Contract
title: Tessiven Flower and operations
description: Generate canvas versions and route service actions through their original owners.
tags: [ai, tessiven, flower]
timestamp: 2026-10-06T00:00:00Z
---
# Summary

Flower maps authorized code, configuration, and connected Runtime facts into
Tessiven versions through the `redeven-tessiven` system skill. Flower owns canvas
content editing as a core workflow. Resource actions
remain owned by the existing Managed Services and Containers managers. A
transport failure after a mutation is dispatched is terminal with an unknown
outcome, so the user must inspect the original manager before trying again.

# Contract

- Tessiven tools read the canonical schema, list/read/validate versions, save a
  complete new version, inspect explicit targets, and execute one exact bound
  instance when the existing permission and approval checks allow it.
- A selected canvas is the update target, including a newly created empty
  canvas. Flower creates another canvas only when the user requests one.
  Renaming and restoring content use read/validate/save against the latest
  version, while discussion of historical selections retains that identity.
- Example targets and inference evidence are fictional. Mapping actual
  infrastructure requires inspecting real targets rather than assigning
  management bindings to example identities.
- Flower preserves stable object IDs, adds evidence and observation times, and
  never guesses a management identity from a name, address, or process.
- Ask Flower carries `canvas_id`, `version_id`, and bounded object references;
  historical selections stay historical during the discussion.
- Canvas editing uses the existing typed Flower send adapters, permission checks,
  and admission controller. Sending does not navigate away from the canvas;
  opening the returned conversation is explicit. Follow-up messages retain its
  thread identity, and unconfirmed delivery retries retain the request identity
  and payload. The canvas does not mirror provider progress or approval state.
- Selection summaries prioritize requested objects and include node, instance,
  and external-resource observation evidence. Truncation is explicit; Flower
  reads the exact saved version for additional detail.
- The UI shows confirmed, refused, and unknown outcomes distinctly. Unknown
  mutation outcomes disable another mutation until the original manager has
  been inspected.

# Boundaries

Flower and the UI call the same Tessiven service; neither writes its database
directly. Runtime and resource references identify targets without granting
permission. Remote requests require an existing authorized Desktop placement
connection exposing Runtime control. A target without that connection remains
unavailable; Tessiven never connects implicitly or substitutes a local target.
Managed Services and Containers retain execution and progress ownership.
External and unmanaged resources support inspection and explanation only.

# Evidence

- `internal/ai/system_skills/redeven-tessiven/SKILL.md`
- `internal/ai/tessiven_tools.go`
- `internal/tessiven/resources.go`
- `internal/tessiven/broker.go`
- `internal/ai/run.go`
