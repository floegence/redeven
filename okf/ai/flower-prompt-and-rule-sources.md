---
type: AI Prompt Contract
title: Flower prompt and rule sources
description: Keep one Flower introduction separate from runtime facts, capabilities and native engine guidance.
tags: [ai, flower, prompts, context]
timestamp: 2026-10-21T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower's host-owned base system prompt contains only its English introduction as
Redeven's general assistant. Every run profile uses the same introduction.
Runtime facts, tool definitions and native Floret guidance retain their own owners
and remain available independently of the product identity.

# Contract

`internal/ai/prompt_builder.go` is the sole source of the base system prompt.

Discovery checks symlinks and Git boundaries; incomplete discovery and context overflow fail admission rather than silently clipping facts.

There is no separate social or creative prompt path.

Deterministic tests require the exact introduction across all 18 permission, profile and allowlist combinations.

Synthetic receipts never execute proposed tools; the Service lane runs inside disposable state. Skipped paid runs are not new model qualification, and historical scores do not establish quality for this prompt.

# Boundaries

Redeven owns Flower's product identity and tool adaptation. Published Floret owns canonical interaction, approval, cancellation, context validation, Goal and recovery. The identity change adds no upstream API, tool schema, storage migration, rule loader or parallel lifecycle.

# Evidence

- redeven:internal/ai/prompt_builder.go — The shared introduction.

- redeven:internal/ai/prompt_profiles.go — Capability profile selection.

- redeven:internal/ai/run_tool_surface.go — Permission-filtered tools and base prompt.
