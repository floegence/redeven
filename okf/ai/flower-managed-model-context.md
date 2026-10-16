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
The primary shared context panel shows a request-scoped breakdown of used
model input: system instructions, tool definitions, user/assistant messages,
tool calls, retained tool outputs, managed context updates, conversation
summaries, retained reasoning and expanded images/files. Floret owns the
semantic offline BPE estimates; Flower maps the published contract without
rebuilding provider history. Categories use one horizontal stacked bar and
aligned localized rows, sorted by size. Estimated token counts and shares are
visibly identified; they are not scaled to the native capacity total. Confirmed
usage and composition come from the same request. Older samples show unavailable
composition until a new request supplies it. Discarded original tool artifacts
never count as model input. Expanded-media budgets come from prepared input.

Complete selectable auto-loaded text remains in a secondary collapsed inspector.
Category colors use the host theme's categorical tokens. The native capacity
bar, output headroom and free space stay separate from estimated composition.
Collection and request-use times remain in the status indicator's accessible
label and hover text. Stable partition keys preserve focus and expanded text
during refresh. Updates do not create chat bubbles, take focus or block
navigation. Keyboard, touch and mouse can open and dismiss the panel; failure
shows source diagnostics and a safe retry action. Subtask details use the same
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
