---
type: AI Context Contract
title: Flower managed runtime facts
description: One snapshot collector supplies canonical facts through published Floret admission and request boundaries.
tags: [ai, flower, context, recovery]
timestamp: 2026-10-16T00:00:00Z
---
# Summary

Flower consumes published Floret v7.47.1. One complete collector supplies four
stable partitions: execution environment, date/timezone, repository rule
sources, and available skills. Floret owns chronological admission,
semantic changes, user-role model-context messages, compaction and recovery.
The product owns collection and authorized presentation only.

# Contract

Admission and the existing dynamic tool surface invoke the same collector. Each
logical provider request uses the current execution configuration and the same
resolved permission for tools and facts. Dates change only on date/timezone
changes. Skill rediscovery uses one authoritative catalog and deterministic
text; disabled or newly restricted skills cannot reuse an activation cache.
Loaded skill instructions remain historical model facts.

## Skill catalog and explicit reads

The automatic skill catalog contains current available names and descriptions in
stable priority/name order. Identical rediscovery and body-only edits do not
append a catalog update. Changes to names, descriptions or the permission-filtered
available set replace the complete skills section through Floret's existing
snapshot contract. Other fact sections retain their own unchanged contracts.

Every explicit `use_skill` rereads and parses the current document after fresh
source, enablement and permission checks. In-process activation state holds only
identity, path and first activation time. `already_active` means the same skill
path was activated previously; it does not establish body freshness or model
visibility. Successful repeated reads keep `activation_id` and return the full
current body, including after compaction. Disabled, deleted, restricted, unreadable
or invalid skills cannot return older instructions as current content. Source
failures are explicit, and cancelled reads do not publish an activation.

Body changes do not inject instructions automatically. Earlier tool results and
prepared network attempts retain their original bytes; subsequent reads add new
tool results. Compaction may summarize an earlier body while retaining the catalog,
so activation state must never suppress an explicit reread.

The deterministic 27-entry fixture measures a 2,397-byte initial catalog and a
2,396-byte full replacement for one description edit (2,477 bytes as section JSON).
Twelve logical requests covering stable scans, body edits, metadata changes,
availability and permission changes produce nine skill-section messages. This
bounded fixture does not justify a per-skill delta protocol. Whole-request wire
bytes and body tool-result bytes are reported separately by the regression tests;
these are byte measurements, not tokenizer counts or production change rates.

## Snapshot lifecycle

UserInput.Context retains ordinary submitted facts and references. Automatic
facts use ModelContextSnapshot, never historical free-text parsing. Queue edits
retain their admitted snapshot; queued execution collects current facts.
Prepared network attempts remain immutable. Steering, authorization and unknown
effect termination retain their existing boundaries.

Required rule or catalog failures terminate with model_context_unavailable.
Collection honors cancellation. Repository root discovery retains its
three-second limit and is used only to bound applicable rule sources.
Safe retry collects again and preserves confirmed tool results. Unknown effects
never replay. Floret keeps exact compaction-cut baselines, chronological tails,
fork-point facts, and permanent schema migrations; hosts do not inspect storage.

Git workspace details are queried on demand through existing tools. The
collector does not run status, branch, upstream, ahead/behind or worktree probes,
and file edits do not append repository background updates. Working directory
and authorized filesystem roots remain execution environment facts. Rule
discovery lists source paths and scopes without loading their contents; the
model reads applicable rules through existing tools.

Existing threads retain historical repository snapshots. The next complete
snapshot omits the repository key, so Floret's existing section-removal message
marks those facts as no longer current. Unchanged later requests do not append
another removal, including after restart. No journal rewrite or schema change
is involved. Explicit Git calls and their complete results remain normal tool
history.

Delegation availability remains an execution-environment fact, with current tool
definitions and existing permission and child-management instructions. Provider
preparation never reads the child inventory for automatic context. Counts,
ordinary lifecycle changes, latest-message previews, preview selection/order,
and child-read errors cannot append managed facts. Explicit status reads and
complete results and passive canonical important events follow the
[subagent tool contract](subagent-runtime.md). Parent events are typed canonical
messages; they never restore the removed delegation snapshot category.

Existing threads omit the old delegation key in their next complete snapshot.
Floret's normal missing-key semantics append one removal, leave old history
immutable, and suppress further unchanged updates. No new thread, storage
migration, historical text parsing, or product-owned snapshot is required.

# Boundaries

Floret is the sole owner of admitted snapshots, model history, compaction and
recovery. Flower collects facts and presents authorized canonical reads through
the existing transport. It does not retain a second snapshot store, parse old
runtime-context text, or reconstruct provider history. Dynamic permissions remain
enforced at actual tool authorization, independently of displayed historical facts.

# Presentation

Authorized canonical reads and the existing workspace subscription carry the
same snapshot, record location, changed/removed keys and latest request use.
The shared context panel groups the displayed request by explicit source:
system prompt, system tool definitions, MCP tool definitions, provider tool
definitions, messages, retained tool execution outputs, skill catalog, repository
rule sources, environment, summaries,
retained reasoning, expanded media, context wrappers and protocol formatting. Floret v7.47.1
provides exact tool names with registry source/namespace annotations and
canonical managed-section token estimates. Flower groups only its known source
values and section keys. It never guesses from tool names or parses prompt text.

Every source uses an aligned horizontal bar and a share of this request's
content weight. Flower estimates category token amounts by allocating the displayed
used-context total according to those shares, regardless of tokenizer quality or
media coverage. Child amounts allocate their parent total by their group shares.
Integer rounding preserves category and group sums; every amount carries an
approximation mark, including tooltips and accessible labels. The calculation
and historical status stay in tooltips and accessible labels rather than adding
another visible heading or badge. A missing used-context total leaves shares only; a missing
breakdown shows an unavailable state. These are display estimates, not
provider-measured category counts or changes to Floret's budget calculations.
Content and protocol framing share the upstream counting core; safety margins
and media budget reserves do not enter category shares. The capacity bar separates
used input and remaining capacity; request output limits stay separate. Parent
source weights replace their detailed weights and are never added twice.
Confirmed total and composition describe the same request; newer snapshots and
projected requests cannot fill gaps in an older sample. Historical missing source
data is visibly unattributed, with no inferred MCP/system split or character-based
allocation.

Sources with multiple fragments and tool sources have one collapsed disclosure.
Opening a source reveals flat horizontal rows; no item expands again or exposes
raw prompt text. MCP entries identify the registered server namespace and tool.
The skill row explicitly names the catalog; activated skill instructions returned
by use_skill remain retained tool outputs. Repository rule sources identify the
discovery list, not unread file contents; subsequent file reads remain outputs.
Shared context framing is explicit formatting overhead rather than a second
auto-loaded snapshot breakdown. Retained historical updates and removals count
through Floret's canonical request renderer.

The compact popup uses a 20rem width with 11px body text and bounded scrolling.
It keeps one header with the total and a trailing close button, the
capacity bar and legend, source bars, and compact cache rates. Budget thresholds,
request output limits and explanatory paragraphs are not shown in this popup.
The indicator opens and dismisses by mouse, touch or keyboard. Internal pointer
interactions cancel pending hover dismissal; transient focus loss to the document
body does not close a hovered popup. Moving focus to an external control, outside
click, Escape and the close button still dismiss it. Internal clicks never reach
the composer's blank-space focus handler. A keyed source
keeps its disclosure state and keyboard focus through live reordering. Theme
colors, bounded scrolling and localized labels work at narrow widths. Measured
panel dimensions refresh placement after disclosure, content and viewport size
changes; the shared floating layer owns projection and boundary clamping. Snapshot
collection and use identities remain in canonical transport; the usage chart
never presents current collection metadata as past request composition. Updates
do not create chat bubbles or block navigation. Subtask details use the same
component and bounded detail cache.

# Evidence

- [Collector](../../internal/ai/prompt_workspace_context.go)
- [Dynamic tool surface](../../internal/ai/run_tool_surface.go)
- [Canonical read projection](../../internal/ai/floret_thread_context.go)
- [Live transport](../../internal/ai/flower_live_stream.go)
- [Shared panel](../../internal/flower_ui/src/chat/FlowerComposerContextIndicator.tsx)
- [Refresh and confirmed-effect retry regression](../../internal/ai/model_context_runtime_integration_test.go)
- [Provider-visible Git removal and retained dynamic facts](../../internal/ai/repository_model_context_integration_test.go)
- [Delegation removal and provider-visible result regressions](../../internal/ai/delegation_model_context_test.go)
- [Skill cache and repaired-source regression](../../internal/ai/skill_model_context_test.go)
- [Provider-visible skill reads, catalog measurements and compaction](../../internal/ai/skill_read_runtime_test.go)
- [Panel interaction tests](../../internal/envapp/ui_src/src/ui/FlowerComposerContextIndicator.test.tsx)
