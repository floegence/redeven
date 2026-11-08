---
type: AI Runtime Contract
title: Model reasoning capability, selection and transport
tags: [ai, models, reasoning, providers]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

One capability catalog and canonicalizer define reasoning controls for saved threads and immutable turns. [Preferences](../ui/flower-conversation-preferences.md) own explicit full-model-identity choices and budgets. Sending/automatic normalization cannot save them; preference failure reports separately without rolling back confirmed thread settings or changing retry snapshots.

# Contract

## Runtime capability
### Capability and transport
OpenAI-compatible Chat reasoning is capability-driven. Redeven reads only response fields named by that result, emits their fragments as reasoning without trimming provider whitespace, and never treats reasoning-only output as assistant body text.

Budget-only and fixed-thinking models never acquire synthetic effort names or a toggle merely because another model supports one.

### Default selection
Default asks for the model's own reasoning behavior. Thread creation, Thread
edits, and every Turn canonicalize it once, in
`config.CanonicalAIReasoningSelection`: on a model without verified reasoning
controls a budget-free Default is the omitted selection and is neither stored
nor sent. Default with a budget, Off, On, and named efforts remain explicit
intent and are rejected for such a model; personal memory keeps no reasoning
choice for it. Clients may send Default without knowing the model's capability
and must not drop or rewrite it themselves.

### Settings ownership
Thread model, reasoning and permission settings are Redeven product state. Execution authority records admission permission for historical attribution only, never as live tool authorization. The configured `current_model_id` initializes future threads only.

### Automatic titles
Published Floret v7.26.0 owns title reasoning and output limits. They never change the thread's saved reasoning choice or the main response policy.

The [live timeline contract](../ui/flower-live-timeline.md) owns canonical title status, persistence, and workspace-summary presentation.

## Selection controls
Loading, reconnecting and rendering never write reasoning preferences. Explicit new-thread Off survives shared remounts/attachment preparation; a confirmed non-reasoning model clears unsupported draft intent.

One localized ordered option list serves all controls; explicit Default remains distinct.

| Capability | Control |
| --- | --- |
| Boolean | Default, supported Off, On |
| Named efforts | Default, supported Off, declared levels only |
| Token budget | Bounded input; clearing removes override |
| Fixed thinking | Noninteractive Always on |
| Unknown thinking controls | Noninteractive Model controlled with explanation |
| No reasoning | No control |

# Boundaries

The same capability and selection reach direct Environment models and Desktop model-source RPC. A model rename never changes its declared control type. Existing database migration lineages remain unchanged.

This is shared Redeven UI policy, not a Floret API or a second preference store. Runtime continuation uses the [immutable Turn surface](floret-thread-runtime.md); no reasoning override is added to an input answer.

# Evidence

- `redeven:internal/config/ai_reasoning_catalog.go` - Source.
- `redeven:internal/ai/initial_turn_reasoning_test.go` - Tests.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.reasoningSelection.browser.test.tsx` - Cold load, explicit intent, failed save/remount and ownership.
