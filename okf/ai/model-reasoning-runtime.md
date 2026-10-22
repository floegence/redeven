---
type: AI Runtime Contract
title: Model reasoning capabilities and transport
description: Discover verified reasoning controls, preserve explicit intent, and map thinking output and history to provider protocols.
tags: [ai, models, reasoning, providers]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Published Floret owns the portable reasoning selection contract, Ollama metadata
parser, and Ollama wire encoding. Redeven maps model metadata, product settings,
and provider requests to that contract. Only verified capabilities create
controls; Default, Off, On, named effort, and token budget retain distinct
meanings. Invalid selections fail before provider dispatch, while unknown
controls retain the model's default behavior. Active Turns keep immutable
settings through continuation and restart.

# Contract

## Capability and transport
OpenAI-compatible Chat reasoning is capability-driven. Redeven reads only response fields named by that result, emits their fragments as reasoning without trimming provider whitespace, and never treats reasoning-only output as assistant body text.

Budget-only and fixed-thinking models never acquire synthetic effort names or a toggle merely because another model supports one.

## Settings ownership
Thread model, reasoning and permission settings are Redeven product state. Execution authority records admission permission for historical attribution only, never as live tool authorization. The configured `current_model_id` initializes future threads only.

## Automatic titles
Published Floret v7.26.0 owns title reasoning and output limits. They never change the thread's saved reasoning choice or the main response policy.

The [live timeline contract](../ui/flower-live-timeline.md) owns canonical title status, persistence, and workspace-summary presentation.

# Boundaries

The same capability and selection reach direct Environment models and Desktop model-source RPC. A model rename never changes its declared control type. Existing database migration lineages remain unchanged.

# Evidence

- `redeven:internal/config/ai_reasoning_catalog.go` - Thin published-Floret metadata mapping and explicit OpenRouter metadata contract.

- `redeven:internal/ai/model_catalog.go` - Read-only discovery from declared capabilities.

- `redeven:internal/ai/model_gateway.go` - Provider request, stream, and approved history-field mapping.
