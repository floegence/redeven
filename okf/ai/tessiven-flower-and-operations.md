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
- Read-only inspection of a missing, non-current, or unauthorized Runtime
  returns structured `unavailable` state without a binding. Descriptive canvas
  references remain unbound and are never treated as connection handles;
  mutation requests against them remain blocked.
- A selected canvas is the update target, including a newly created empty
  canvas. Flower creates another canvas only when the user requests one.
  Renaming and restoring content use read/validate/save against the latest
  version, while discussion of historical selections retains that identity.
- Example targets and inference evidence are fictional. Mapping actual
  infrastructure requires inspecting real targets rather than assigning
  management bindings to example identities.
- Flower preserves stable object IDs, adds evidence and observation times, and
  never guesses a management identity from a name, address, or process.
- Mixed deployments reuse physical node IDs across logical group `nodeRefs`
  and use exact `instanceRefs` to distinguish projects and same-type clusters.
  They never duplicate hosts, instances, bindings, or permissions to create a
  second visual appearance.
- Generation defaults to automatic layout. Flower preserves intentional existing
  hints and adds coordinates only for a requested arrangement; it does not guess
  compact card geometry. Schema validation and saving prove document validity
  and persistence, while the [canvas UI contract](../ui/tessiven-canvas.md) owns
  actual rendering and preferred-coordinate collision resolution.
- Ask Flower carries `canvas_id`, `version_id`, and bounded object references;
  historical selections stay historical during the discussion.
- Canvas editing embeds the canonical Flower surface with its existing typed
  adapters and permission checks. Composer and floating output share one thread
  runtime. Sending, reading replies, answering questions and approving actions
  stay on the canvas. Opening the full conversation is optional. Follow-up
  messages retain the canvas conversation, and unconfirmed delivery retries
  retain the frozen request identity and payload. Tessiven owns placement and
  exact selection context; it does not mirror provider or approval state.
- Selection summaries prioritize requested objects and include node, instance,
  and external-resource observation evidence. Truncation is explicit; Flower
  reads the exact saved version for additional detail.
  Host and instance selections also include their logical group membership;
  this addition does not select unrelated hosts in those groups.
- The UI shows confirmed, refused, and unknown outcomes distinctly. Unknown
  mutation outcomes disable another mutation until the original manager has
  been inspected.

# Boundaries

Flower and the UI call the same Tessiven service; neither writes its database
directly. Runtime and resource references identify targets without granting
permission or creating a connection. Remote requests require an existing
authorized Desktop placement connection exposing Runtime control. A target
without that connection remains unavailable in read-only results and cannot be
mutated; Tessiven never connects implicitly or substitutes a local target.
Managed Services and Containers retain execution and progress ownership.
External and unmanaged resources support inspection and explanation only.

# Evidence

- `internal/tessiven/context_test.go` - Canonical host and instance selections retain logical membership.

- `internal/ai/system_skills/redeven-tessiven/SKILL.md`
- `internal/ai/tessiven_tools.go`
- `internal/tessiven/resources.go`
- `internal/tessiven/broker.go`
- `internal/ai/run.go`
