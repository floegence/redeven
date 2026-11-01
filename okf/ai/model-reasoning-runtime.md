---
type: AI Runtime Contract
title: Model reasoning capabilities and transport
tags: [ai, models, reasoning, providers]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Published Floret owns reasoning choices, Ollama metadata and wire encoding; Redeven maps verified capabilities and settings. Default, Off, On, effort and budget remain distinct. Invalid selection rejects before dispatch; unknown controls retain model defaults. Active turns keep immutable settings through restart.

# Contract

## Capability and transport
OpenAI-compatible Chat reasoning is capability-driven. Redeven reads only response fields named by that result, emits their fragments as reasoning without trimming provider whitespace, and never treats reasoning-only output as assistant body text.

Budget-only and fixed-thinking models never acquire synthetic effort names or a toggle merely because another model supports one.

## Default selection
Default asks for the model's own reasoning behavior. Thread creation, Thread
edits, and every Turn canonicalize it once, in
`config.CanonicalAIReasoningSelection`: on a model without verified reasoning
controls a budget-free Default is the omitted selection and is neither stored
nor sent. Default with a budget, Off, On, and named efforts remain explicit
intent and are rejected for such a model; personal memory keeps no reasoning
choice for it. Clients may send Default without knowing the model's capability
and must not drop or rewrite it themselves.

## Settings ownership
Thread model, reasoning and permission settings are Redeven product state. Execution authority records admission permission for historical attribution only, never as live tool authorization. The configured `current_model_id` initializes future threads only.

## Automatic titles
Published Floret v7.26.0 owns title reasoning and output limits. They never change the thread's saved reasoning choice or the main response policy.

The [live timeline contract](../ui/flower-live-timeline.md) owns canonical title status, persistence, and workspace-summary presentation.

# Boundaries

The same capability and selection reach direct Environment models and Desktop model-source RPC. A model rename never changes its declared control type. Existing database migration lineages remain unchanged.

# Evidence

- `redeven:internal/config/ai_reasoning_catalog.go` - Public Floret/OpenRouter metadata mapping.

- `redeven:internal/ai/model_catalog.go` - Read-only discovery from declared capabilities.

- `redeven:internal/ai/initial_turn_reasoning_test.go` - Default unsupported reasoning emits no OpenAI-compatible reasoning fields.
