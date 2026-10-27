---
type: UI Contract
title: Flower reasoning selection ownership
description: Preserve explicit reasoning choices across cold loads, shared drafts, submission, and restart.
tags: [ai, flower, reasoning, composer]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Existing threads display confirmed reasoning settings independently of runtime view versions; new drafts retain only explicit choices. Default is a configuration choice, never On or an inferred effort. Verified capabilities determine controls; unknown controls remain model-controlled. Failed saves preserve confirmed settings and active turns keep immutable execution configuration.

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

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Resolve confirmed settings independently from explicit drafts and freeze submission options.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.reasoningSelection.browser.test.tsx` - Cold loading, explicit intent, failed saves, remounts, and request ownership.
