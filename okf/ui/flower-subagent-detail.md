---
type: UI Contract
title: Flower subagent detail presentation
description: Parent header membership, canonical thread routing, and child execution detail and canonical input controls.
tags: [ai, flower, subagents, ui]
timestamp: 2026-10-21T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: Floret v7 parent-scoped `ThreadRuntime.List` owns child membership; the child's complete `ThreadView` is the only detail-content authority.
- Outcome: Flower opens a stable, parent-scoped detail window immediately and updates it live without polling or layout-changing sync chrome.
- Invariants: every public child route uses canonical `thread_id`; `task_name` is required and never guessed from title, role, description, or message.
- Failure boundary: malformed summaries, missing canonical identity, parent-child mismatch, or invalid detail contracts are rejected rather than mapped through legacy aliases.

# Contract

The parent header replaces the numeric robot badge with at most three circular canonical portraits and a separate `+N` remainder.

[Subagent detail window](flower-subagent-detail-window.md) owns complete current-view reads, live replacement, Activity rendering, child navigation, and queued-input controls.

# Boundaries

Flower must not recover a missing child identity from activity sidecars, a title, a delegated approval alias, a fallback thread id, or local state.

The dropdown lists tasks only.

# Evidence

- `redeven:internal/flower_ui/src/SubagentAvatarStack.tsx` - Owns bounded portrait rotation and local motion cleanup.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.subagentHeader.browser.test.tsx` - Verifies running overflow, live completion, gray settlement, motion preferences, themes, and narrow header access.

- `redeven:internal/ai/types.go:172` - Backend SubAgent summaries expose canonical thread identity only.
