---
type: UI Contract
title: Flower setup and settings
description: First-time model setup, actionable starter tasks, and shared provider, permission, and computer settings.
tags: [ai, flower, settings, onboarding]
timestamp: 2026-10-16T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The shared Flower surface owns setup and settings for Desktop and Env App.
An empty profile without a usable model or selected conversation offers explicit
setup actions. Configured new conversations offer starter tasks as editable
drafts; selecting one never launches a turn. Settings use flat sections and
preserve drafts, model-source identity and permission ownership. Connection
failures and configured profiles needing repair retain their recovery controls.
Settings open in a shared modal dialog over the mounted chat. Background chat
and navigation stay visible but inert until the dialog finishes closing; covered
chat does not acknowledge reads. Settings save progress and errors survive hiding.

# Contract

## First-time setup
The welcome replaces disabled suggestions only when no thread is selected, no provider is configured, no model is usable, and the Desktop source is absent, `not_configured`, or `empty`. In a Desktop `local_host` session, the sole destination is the current Flower surface's settings dialog; it must not open or focus another Welcome window or identify the local environment as remote.

The shared icon artwork stays bare, without restoring the removed glow or a continuous animation.

## Starter tasks
The configured new-conversation page offers four everyday tasks: understand the current folder's contents and how to use them, understand the connected computer, discover installed applications, and prepare a folder organization plan.

Matching names or older dates alone never justify deletion.

The compact companion continues to omit the task grid as specified by the [companion presentation contract](flower-activity-companion.md).

## Settings composition
Settings edit the environment profile even with a Desktop model source.

Switch saves are immediate, block duplicate edits, and restore the previous state on failure.

The shared settings panel stays mounted when returning to chat.

## Provider configuration
Provider layout, authentication choices, and connection-before-model sequencing belong to [Flower provider configuration](flower-provider-configuration.md).

## Retained panels
FlowerSurface owns chat and extensions plus one lazily loaded settings form. A bounded, scrollable body adapts to the visible viewport.

Settings dialog interactions belong to the companion; closing the dialog leaves the companion expanded, while the host collapse action closes both without discarding forms.

## Saving and ownership
The adapter exposes independent `saveDefaultPermission`, `saveModelProfile`, and `persistDefaultModel` operations. Default permission uses a serialized 700 ms controller that coalesces rapid changes, protects newer choices from older responses, and restores the last confirmed value on failure. Computer-use save failures restore the confirmed switch and expose the error.

# Boundaries

Starter-task selection creates an editable draft, never a turn.

Permission descriptions sit outside the single-line selection buttons and are linked through accessible descriptions; arrow-key selection and autosave retain their existing owner.

# Evidence

- `redeven:internal/flower_ui/src/i18n/flowerSurfaceMessages.ts` - Canonical localized task copy and complete seeded prompts.

- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.starterTasks.browser.test.tsx` - Localized card layout, complete draft insertion, keyboard and pointer focus handoff, and no automatic submission.

- `redeven:desktop/src/welcome/flower/desktopFlowerSurfaceCopy.test.tsx` - Desktop and shared English starter-copy parity.
