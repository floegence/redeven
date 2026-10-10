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
  Renaming and restoring content use version-checked writes, while discussion
  of historical selections retains that identity.
- Existing canvases support bounded literal YAML reads (default 200, maximum
  500 lines and 64 KiB), paginated literal search, and exact replacement batches.
  Search and read return immutable version identity. `tessiven.edit` applies
  1–50 ordered, uniquely matching replacements, preserves untouched YAML bytes,
  validates the complete result, and commits one version through the same save
  transaction and permission boundary as full save. Invalid matches, invalid
  documents and stale versions change nothing. Retry identity covers the exact
  edit arguments, not merely the resulting document. Stored versions remain
  complete snapshots; partial model input does not introduce a storage lineage.
  The skill prefers search/read/edit for ordinary changes and validate/save for
  creation or an explicitly requested wholesale rewrite.
- Tool activity names the canvas operation and meaningful title, never an opaque
  canvas ID. Read details show literal YAML and line bounds; edit details show
  replacement fragments; save results show the title, version and summary.
  Typed bounded tool results retain their JSON shape rather than being converted
  to a generic truncated raw string. Terminal activity omits the redundant
  `local_runtime` suffix while preserving meaningful remote target identity.
- Example targets and inference evidence are fictional. Mapping actual
  infrastructure requires inspecting real targets rather than assigning
  management bindings to example identities.
- Flower preserves stable object IDs, adds evidence and observation times, and
  never guesses a management identity from a name, address, or process.
- Flower models every service on nodes through instances, including inferred
  unbound placements in reference architectures. External dependencies use
  resources. It never removes deployment placements to simplify visuals;
  browsing controls handle density. Historical read diagnostics identify
  missing placements and invalid service-level layout hints; Flower uses
  evidence to repair these before creating a new version under the
  [document contract](../architecture/tessiven-canvas-contract.md).
  Save validation failures are typed invalid-argument results with source paths
  and full diagnostic results, so Flower can correct the document rather than
  treating the failure as a transport error.
- Mixed deployments reuse physical node IDs across logical group `nodeRefs`
  and use exact `instanceRefs` to distinguish projects and same-type clusters.
  They never duplicate hosts, instances, bindings, or permissions to create a
  second visual appearance.
- Generation defaults to automatic layout without positions or layers. For
  explicit spatial intent, Flower expresses direction and ordered root layers
  through the [document layout contract](../architecture/tessiven-canvas-contract.md).
  It preserves existing choices during ordinary updates and replaces obsolete
  coordinates only for an explicitly requested reorganization. It never guesses
  compact card geometry or generates edge paths. Schema validation and saving prove document validity
  and persistence, while the [canvas UI contract](../ui/tessiven-canvas.md) owns
  actual rendering and preferred-coordinate collision resolution.
- Ask Flower carries `canvas_id`, `version_id`, and bounded object references;
  historical selections stay historical during the discussion. Under the
  [canvas context contract](../ui/tessiven-canvas.md), an implicit whole-canvas
  snapshot initializes a new conversation only. Ordinary follow-ups reuse
  canonical thread context, while explicit object and file references remain
  attached when selected.
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
- `internal/tessiven/edit.go`
- `internal/tessiven/edit_test.go`
- `internal/ai/tool_activity_details_test.go`
- `internal/flower_ui/src/flowerActivityPresentation.test.ts`
- `internal/tessiven/resources.go`
- `internal/tessiven/broker.go`
- `internal/ai/run.go`
