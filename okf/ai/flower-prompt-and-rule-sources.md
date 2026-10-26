---
type: AI Prompt Contract
title: Flower prompt and rule sources
description: Keep shared Flower identity and output guidance separate from runtime facts, capabilities and native engine guidance.
tags: [ai, flower, prompts, context]
timestamp: 2026-10-21T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-26"
---
# Summary

Flower's host-owned base system prompt contains its English introduction as
Redeven's general assistant, visual output guidance and local file-delivery rules.
Every run profile uses the same base prompt.
Runtime facts, tool definitions and native Floret guidance retain their own owners
and remain available independently of the product identity.

# Contract

`internal/ai/prompt_builder.go` is the sole source of the base system prompt.

Visual output uses the existing [inline HTML preview](../ui/flower-inline-media.md)
contract when it communicates better than text; ordinary nonvisual answers remain
text. Existing direct WebGL guidance remains unchanged.

Delivering a created or confirmed local file requires a clickable Markdown link
with a clear file name or title and the full absolute path. Plain text or inline
code cannot be the only delivery entry point. Destinations containing spaces or
parentheses use angle brackets, such as `[Report](</workspace/report (final).html>)`.
Paths must not be invented and links must not use `file://`. Paths inside commands
and code examples may remain code. Existing authorized file previews own opening;
this prompt rule does not change historical messages or file authorization.

Discovery checks symlinks and Git boundaries; incomplete discovery and context overflow fail admission rather than silently clipping facts.

There is no separate social or creative prompt path.

Deterministic tests require the exact base prompt across all 18 permission, profile
and allowlist combinations, preserve tool-definition hashes, check file-delivery
requirements and bound the prompt to 1,200 bytes.

Synthetic receipts never execute proposed tools; the Service lane runs inside disposable state. Skipped paid runs are not new model qualification, and historical scores do not establish quality for this prompt.

# Boundaries

Redeven owns Flower's product identity, output guidance and tool adaptation. Published Floret owns canonical interaction, approval, cancellation, context validation, Goal and recovery. These prompt rules add no upstream API, tool schema, storage migration, rule loader or parallel lifecycle.

# Evidence

- redeven:internal/ai/prompt_builder.go — Shared identity and output instructions.

- redeven:internal/ai/prompt_builder_tool_routing_test.go — Exact prompt and file-delivery contracts.

- redeven:internal/ai/prompt_consistency_test.go — All-profile prompt and unchanged tool-definition checks.

- redeven:internal/ai/prompt_profiles.go — Capability profile selection.

- redeven:internal/ai/run_tool_surface.go — Permission-filtered tools and base prompt.
