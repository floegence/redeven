---
type: UI Contract
title: Flower subagent detail presentation
description: Parent header membership, canonical thread routing, and read-only child execution detail.
tags: [ai, flower, subagents, ui]
timestamp: 2026-08-15T00:00:00Z
---
# Summary

- Authority: Floret v4 parent-scoped `ThreadRuntime.List` owns child membership and typed `View` owns child execution detail.
- Outcome: Flower opens a parent-scoped, read-only child view without navigating away from the parent conversation.
- Invariants: every public child route uses canonical `thread_id`; `task_name` is required and never guessed from title, role, description, or message.
- Failure boundary: malformed summaries, missing canonical identity, parent-child mismatch, or invalid detail contracts are rejected rather than mapped through legacy aliases.

# Contract

Thread-level child membership comes from Floret v4 `ThreadRuntime.List` scoped by canonical parent id. Redeven maps typed summaries and current views into `thread.subagents` for bootstrap and live current updates. Thread list refreshes that omit detail preserve selected-thread detail; only an explicit typed detail value replaces it. The header dropdown never scans transcript activity, audit rows, or product settings to infer membership.

`FlowerSubagentSummary` contains `parent_thread_id`, canonical child `thread_id`, required `task_name`, task description, agent type, context mode, status, timing, and current control flags. There is no `subagent_id` or `title` compatibility field. Activity payloads route `Open messages` with `thread_id` only. Delegated approval presentation uses `child_thread_id`; it does not duplicate the same identity under another name.

The dropdown is a compact accessible floating surface over the parent thread. Active and ended groups stay visible, rows sort by canonical status and update time, and keyboard navigation supports arrows, Home, End, Enter, and Escape. Selecting a row opens the parent-scoped detail API in a read-only floating window. It does not select a sidebar child thread or create a child composer.

The detail window maps the canonical child `ThreadView` messages, interactions, and Activity into the shared renderers. It supports active current-view replacement, bottom-follow behavior, local retry, and disclosure-preserving operation groups. The detail is human UI state and is not injected into the parent model context or persisted as a second transcript.

# Boundaries

Flower must not recover a missing child identity from activity sidecars, a title, a delegated approval alias, a fallback thread id, or local state. It must not humanize an absent task name into a role-based label. Redeven does not read Floret storage tables, persist child membership, or use detail events as a second transcript authority; optional child product settings contain presentation and policy only.

# Evidence

- `redeven:internal/ai/types.go:172` - Backend SubAgent summaries expose canonical thread identity only.
- `redeven:internal/ai/subagents_floret.go` - Membership and detail read through parent-scoped Floret v4 typed APIs.
- `redeven:internal/flower_ui/src/contracts/flowerSurfaceContracts.ts:486` - UI contracts require `thread_id` and `task_name` without aliases.
- `redeven:internal/flower_ui/src/flowerLiveMapper.ts:744` - Wire mapping accepts only canonical child thread identity.
- `redeven:internal/flower_ui/src/flowerSubagentProjection.ts:128` - Header rows derive directly from canonical summaries.
- `redeven:internal/flower_ui/src/flowerSubagentDetailThread.ts:304` - Child detail requires canonical summary identity and task name.
