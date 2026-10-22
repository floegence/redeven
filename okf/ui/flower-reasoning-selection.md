---
type: UI Contract
title: Flower reasoning selection ownership
description: Preserve explicit reasoning choices across cold loads, shared drafts, submission, and restart.
tags: [ai, flower, reasoning, composer]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Confirmed Thread settings own the reasoning level displayed for an existing Flower conversation. Drafts own only explicit new-thread choices; computed defaults never become draft intent. Default reasoning is a configuration choice, not an enabled state or an effort level. Cold loading and restart preserve explicit Off and On. Controls reflect verified model capabilities; unknown controls remain model-controlled. Failed saves retain the confirmed setting, and active Turns retain their immutable runtime configuration.

# Contract

Existing Threads display the newest confirmed settings snapshot in `ThreadCache`, comparing settings revisions independently of runtime view versions. Loading, reconnecting, and rendering must never write a reasoning preference.

New-thread Off survives shared-surface remounts and attachment preparation, while changing to a confirmed model without reasoning clears the unsupported draft choice.

[Conversation preferences](flower-conversation-preferences.md) store only explicit reasoning choices, keyed by the complete model identity and including budget tokens. Loading, sending, reconnecting, and automatic model normalization never write preferences. A preference-save failure retains the confirmed Thread result and reports a separate save error; active Turns and retry snapshots remain immutable.

All shared control variants use one ordered option list and localized labels. An explicit `default` is never labeled On or replaced with a specific effort.

The UI does not infer an effective provider default.

The shared Desktop and Env App control distinguishes these model contracts:

| Declared capability | Presentation |
| --- | --- |
| Boolean toggle | Default, Off when supported, and explicit On |
| Named efforts | Default, Off when supported, and only declared supported levels |
| Token budget | Bounded token input; clearing it removes the override |
| Fixed thinking | Non-interactive Always on status |
| Thinking with unknown controls | Non-interactive Model controlled status with an explanation |
| No reasoning | No reasoning control |

# Boundaries

This is shared Redeven UI policy, not a Floret API or a second preference store. Runtime continuation uses the [immutable Turn surface](../ai/floret-thread-runtime.md); no reasoning override is added to an input answer.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Resolve confirmed settings independently from explicit drafts and freeze submission options.

- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - Connection-local explicit new-thread reasoning choice.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.reasoningSelection.browser.test.tsx` - Cold loading, explicit intent, failed saves, remounts, and request ownership.
