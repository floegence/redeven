---
type: UI Contract
title: Flower reasoning selection ownership
tags: [ai, flower, reasoning, composer]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Threads display confirmed reasoning independently of view revisions; new drafts retain explicit choices. Default means configuration, not On/guessed effort. Verified capabilities alone determine controls. Failed saves retain confirmed state and active turns keep frozen execution settings.

# Contract

Loading, reconnecting and rendering never write reasoning preferences. Explicit new-thread Off survives shared remounts/attachment preparation; a confirmed non-reasoning model clears unsupported draft intent.

[Preferences](flower-conversation-preferences.md) own explicit full-model-identity choices and budgets. Sending/automatic normalization cannot save them; preference failure reports separately without rolling back confirmed thread settings or changing retry snapshots. One localized ordered option list serves all controls; explicit Default remains distinct.

| Capability | Control |
| --- | --- |
| Boolean | Default, supported Off, On |
| Named efforts | Default, supported Off, declared levels only |
| Token budget | Bounded input; clearing removes override |
| Fixed thinking | Noninteractive Always on |
| Unknown thinking controls | Noninteractive Model controlled with explanation |
| No reasoning | No control |

# Boundaries

This is shared Redeven UI policy, not a Floret API or a second preference store. Runtime continuation uses the [immutable Turn surface](../ai/floret-thread-runtime.md); no reasoning override is added to an input answer.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.reasoningSelection.browser.test.tsx` - Cold load, explicit intent, failed save/remount and ownership.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.reasoningSelection.browser.test.tsx` - Tests.
