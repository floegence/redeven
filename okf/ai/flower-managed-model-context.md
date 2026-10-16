---
type: AI Context Contract
title: Flower managed runtime facts
description: One snapshot collector supplies canonical facts through published Floret admission and request boundaries.
tags: [ai, flower, context, recovery]
timestamp: 2026-10-15T00:00:00Z
---
# Summary

Flower consumes published Floret v7.40.0. One complete collector supplies six
stable partitions: execution environment, date/timezone, repository state, rule
sources, available skills, and delegation. Floret owns chronological admission,
semantic changes, user-role model-context messages, compaction and recovery.
The product owns collection and authorized presentation only.

# Contract

Admission and the existing dynamic tool surface invoke the same collector. Each
logical provider request uses the current execution configuration and the same
resolved permission for tools and facts. Dates change only on date/timezone
changes. Skill rediscovery uses one authoritative catalog and deterministic
text; disabled or newly restricted skills cannot reuse an activation cache.
Loaded skill instructions remain historical model facts.

UserInput.Context retains ordinary submitted facts and references. Automatic
facts use ModelContextSnapshot, never historical free-text parsing. Queue edits
retain their admitted snapshot; queued execution collects current facts.
Prepared network attempts remain immutable. Steering, authorization and unknown
effect termination retain their existing boundaries.

Required rule or catalog failures terminate with model_context_unavailable.
Optional Git/delegation probe failures explicitly invalidate previous facts.
Collection honors cancellation and the existing three-second Git limit.
Safe retry collects again and preserves confirmed tool results. Unknown effects
never replay. Floret keeps exact compaction-cut baselines, chronological tails,
fork-point facts, and permanent schema migrations; hosts do not inspect storage.

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
system prompt, system tools, MCP tools, provider tools, messages, retained tool
outputs, skill catalog, repository rule sources, environment, summaries,
retained reasoning, expanded media and formatting overhead. Floret v7.45.0
provides exact tool names with registry source/namespace annotations and
canonical managed-section token estimates. Flower groups only its known source
values and section keys. It never guesses from tool names or parses prompt text.

Every source uses an aligned horizontal bar with approximate tokens and share
of the estimated input. Native input, output reserve and free capacity remain a
separate capacity bar. Parent source weights replace their detailed weights;
they are never added twice or scaled to match native usage. Confirmed total and
composition describe the same request; newer snapshots and projected requests
cannot fill gaps in an older sample. Historical missing source data is visibly
unattributed, with no inferred MCP/system split or character-based allocation.

Sources with multiple fragments and tool sources have one collapsed disclosure.
Opening a source reveals flat horizontal rows; no item expands again or exposes
raw prompt text. MCP entries identify the registered server namespace and tool.
The skill row explicitly names the catalog; activated skill instructions returned
by use_skill remain retained tool outputs. Repository rule sources identify the
discovery list, not unread file contents; subsequent file reads remain outputs.
Shared context framing is explicit formatting overhead rather than a second
auto-loaded snapshot breakdown. Retained historical updates and removals count
through Floret's canonical request renderer.

The indicator opens and dismisses by mouse, touch or keyboard. A keyed source
keeps its disclosure state and keyboard focus through live reordering. Theme
colors, bounded scrolling and localized labels work at narrow widths. Snapshot
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
- [Skill cache and repaired-source regression](../../internal/ai/skill_model_context_test.go)
- [Panel interaction tests](../../internal/envapp/ui_src/src/ui/FlowerComposerContextIndicator.test.tsx)
