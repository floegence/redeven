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

Floret parent-scoped ThreadRuntime.List owns membership; complete child ThreadView alone owns details. Open a stable immediate live window without polling/layout-changing sync UI. Routes use thread_id and explicit task_name, never inferred aliases. Malformed identity/contracts or parent-child mismatch fail rather than accepting legacy substitutes.

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
