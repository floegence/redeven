---
type: UI Contract
title: Flower reasoning selection ownership
description: Preserve explicit reasoning choices across cold loads, shared drafts, submission, and restart.
tags: [ai, flower, reasoning, composer]
timestamp: 2026-09-08T00:00:00Z
---
# Summary

Confirmed Thread settings own the reasoning level displayed for an existing Flower conversation. Drafts own only explicit new-thread choices; computed defaults never become draft intent. Default reasoning is a configuration choice, not an enabled state or an effort level. Cold loading and restart preserve Off. Failed saves retain the confirmed setting, and active Turns retain their immutable runtime configuration.

# Contract

Existing Threads display the newest confirmed settings snapshot in `ThreadCache`, comparing settings revisions independently of runtime view versions. A saved `off` remains explicit even when the model defaults to `high`. Cold detail loads may use confirmed summary settings; if neither snapshot is available, the segment shows a fixed-width, non-interactive loading placeholder. Loading, reconnecting, and rendering must never write a reasoning preference.

The connection-local composer draft stores only an explicit new-thread reasoning choice. Effective model defaults and existing-thread settings are read-only projections, never draft input. Launch freezes effective reasoning in the request/outbox snapshot without promoting it to a draft override; existing-thread sends omit reasoning overrides. Admission transfers ownership to confirmed thread settings. An old existing-thread draft cannot mask those settings. A pending preference save disables conflicting model/reasoning edits, leaves the last confirmed value visible, and reports failures through the host notification channel. Its response updates only the owning Thread and cannot change navigation.

Running and waiting Threads expose no editable reasoning control. Input answers continue the immutable Turn surface through the existing runtime contract; they do not submit a reasoning override. New-thread Off survives shared-surface remounts and attachment preparation, while changing to a confirmed model without reasoning clears the unsupported draft choice.

# Default and effort presentation

All shared control variants use one ordered option list and localized labels.
An effort control includes Default, Off when supported, and only the catalog's
supported levels. Default remains selectable even when the catalog has no
`default_level`. An explicit `default` is never labeled On or replaced with a
specific effort. Existing model/profile default resolution still applies when
no explicit selection exists; rendering never writes that resolved choice.

Returning to Default submits the existing `level: default` selection. Toggle
and budget defaults also remain labeled Default rather than claiming enabled
reasoning. An explicit budget displays its token count, and Off takes precedence
over budget presentation. Turning Off clears the budget as before. Running and
waiting Turns retain their frozen settings.

DeepSeek's published Floret transport omits explicit reasoning effort for absent
or Default selections, sends `none` for Off, and preserves supported Low, High,
and Max selections. The UI does not infer an effective provider default.

# Boundaries

This is shared Redeven UI policy, not a Floret API or a second preference store. The model catalog and navigation remain governed by [Flower model and navigation presentation](flower-model-navigation.md). Runtime continuation uses the [immutable Turn surface](../ai/floret-thread-runtime.md); no reasoning override is added to an input answer.

# Evidence

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Resolve confirmed settings independently from explicit drafts and freeze submission options.
- `redeven:internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.ts` - Connection-local explicit new-thread reasoning choice.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.reasoningSelection.browser.test.tsx` - Cold loading, explicit intent, failed saves, remounts, and request ownership.
- `redeven:internal/ai/thread_reasoning_restart_test.go` - Persisted Off survives service reopening and waiting continuation with DeepSeek wire requests.

- `redeven:internal/envapp/ui_src/src/ui/ReasoningControl.browser.test.tsx` - Default/effort labels, budgets, localization, and keyboard interaction.
- `redeven:internal/ai/model_gateway_deepseek_test.go` - Published Floret transport reasoning selection wire contract.
