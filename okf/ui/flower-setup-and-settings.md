---
type: UI Contract
title: Flower setup and settings
description: First-time model setup, actionable starter tasks, and shared provider, permission, and computer settings.
tags: [ai, flower, settings, onboarding]
timestamp: 2026-09-21T00:00:00Z
---
# Summary

The shared Flower surface owns first-time configuration and settings presentation
for Desktop and Env App. An empty provider profile with no usable model and no
selected conversation presents a neutral welcome with explicit setup actions.
Configured new conversations offer concrete starter tasks as editable drafts;
selecting one never launches a turn automatically.
Settings use flat sections, typography, spacing, and separators instead of nested
rounded panels. Presentation must preserve drafts, model-source identity, and
permission ownership. Connection failures and configured profiles needing repair
retain their existing recovery controls instead of being described as first setup.

# First-time setup

The welcome replaces disabled suggestions only when no thread is selected, no
provider is configured, no model is usable, and the Desktop source is absent,
`not_configured`, or `empty`. It identifies Flower and offers a visible settings
action. When the host provides both setup destinations, Desktop Flower settings
and the current environment's Flower settings appear as separate, fully readable
buttons. Both remain usable in an expanded companion or narrow viewport.

The ordinary composer stays mounted but hidden while the welcome is visible.
Refreshing models calls the existing settings refresh operation. Once a usable
model is available, the welcome gives way to the normal empty state and the same
composer, preserving its text, references, and attachments. The collapsed
companion keeps its compact composer recovery controls. Thread navigation remains
available, and selecting an existing conversation shows its normal history.

Configured profiles with missing credentials and actual Desktop connection or
protocol failures use the existing composer and model-menu recovery contracts in
[model and navigation presentation](flower-model-navigation.md). Refresh failure
uses host feedback and never clears drafts or silently selects another source.

The configured new-conversation empty state uses the original one-shot welcome
flower rotation: a 1.2-second turn with a small overshoot and scale rebound,
after a 150 ms delay. It finishes at rest and does not replay on directory or
draft edits. Reduced motion disables it. The shared icon artwork stays bare,
without restoring the removed glow or a continuous animation.

# Starter tasks

The configured new-conversation page offers four everyday tasks: understand the
current folder's contents and how to use them, understand the connected computer,
discover installed applications, and prepare a folder organization plan. Compact
card titles and descriptions name the outcome. Each complete localized prompt
defines its scope, evidence, and deliverable without assuming the user is a
developer or the current directory is a code repository.

Folder exploration explains purpose, features, audience, and getting-started
steps from actual documentation and available prerequisites. Documents and
reference materials receive a content overview and reading order; multiple
independent projects receive an overview before the user chooses one.

The computer check identifies the actual device and whether it is local or
remote, reports specifications and current resource use, and explains observed
conditions without treating a single sample as proof of a persistent problem.
Application discovery groups actual installed apps by everyday use, suggests
concrete tasks, and distinguishes installation from confirmed usability. Neither
task changes settings, ends processes, or installs or starts applications.

Folder organization proposes a simple structure with concrete before/after
locations, preserves references and application dependencies, and waits for user
confirmation before applying moves or renames. Matching names or older dates
alone never justify deletion. All four prompts report unavailable or uncertain
information honestly and deliver their initial findings in the conversation.

Activating a card by pointer or keyboard fills the complete editable composer
draft and places the caret at its end. It never launches a turn automatically;
the user can revise the request before sending it. Long prompts remain within
the scrolling composer. Runtime permissions still govern all submitted work.
The compact companion continues to omit the task grid as specified by the
[companion presentation contract](flower-activity-companion.md).

# Settings composition

The settings surface edits the environment profile even when a Desktop model
source is available. The current model and provider list come first, followed by
default permission and computer/browser controls. Model limits use localized
labels. Provider rows avoid repeating the provider type when it already matches
the display name, and model identifiers remain fully readable when expanded.

Four peer sections share one page background: current model, providers, default
permission, and computer/browser use. Each has a localized accessible name and a
full-width separator with generous vertical spacing. Wide containers align section
titles and descriptions in a dedicated left column with controls in a shared right
column. At 760 CSS pixels or below they stack, preserving the reading order.

Current-model capabilities, capacity figures, and reasoning preferences have
separate visual groups. Provider rows always expose identity, credential readiness,
and edit/remove actions. A keyboard-operable model disclosure shows the configured
count and expands to every model identifier plus web/image capability details;
identifiers wrap rather than hiding the rest of the inventory behind a count.
Adding a provider remains directly available without expanding details.

Permission choices remain visible as a vertical radio group, with a check indicator,
restrained selected fill, and a left selection rule. Long translations must wrap
without covering adjacent values. Buttons, switches, and disclosure summaries
retain keyboard focus and pointer affordances. Input boundaries use the published
Floe focus contract.

Computer use remains a separately saved switch with a visible thumb in both
themes. The self-managed Chromium connection form is an expandable advanced
section; collapsing it does not destroy its address or connection result.
Discovery, profile/tab selection, and explicit connection retain their existing
runtime operations. The shared settings panel stays mounted when returning to chat.

# Saving and ownership

The adapter exposes independent `saveDefaultPermission`, `saveModelProfile`, and
`persistDefaultModel` operations. Provider dialogs save directly; model choices
and default permissions retain their existing autosave behavior. Default
permission uses a serialized 700 ms controller that coalesces rapid changes,
protects newer choices from older responses, and restores the last confirmed
value on failure. It applies to new conversations only. Existing-thread defaults
and admitted turns remain governed by the [model and navigation contract](flower-model-navigation.md).
Computer-use save failures restore the confirmed switch and expose the error.

# Evidence

- `redeven:internal/flower_ui/src/i18n/flowerSurfaceMessages.ts` - Canonical localized task copy and complete seeded prompts.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.starterTasks.browser.test.tsx` - Localized card layout, complete draft insertion, keyboard and pointer focus handoff, and no automatic submission.
- `redeven:desktop/src/welcome/flower/desktopFlowerSurfaceCopy.test.tsx` - Desktop and shared English starter-copy parity.
- `redeven:internal/envapp/ui_src/src/ui/FlowerWorkingDirectory.browser.test.tsx` - One-shot welcome rotation, overshoot, stable draft edits, and reduced motion.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:2846` - First-time setup eligibility and retained composer ownership.
- `redeven:internal/flower_ui/src/chat/FlowerSetupWelcome.tsx:7` - Setup destinations and model refresh presentation.
- `redeven:internal/flower_ui/src/settings/FlowerSettingsSurface.tsx:174` - Shared settings actions and save controllers.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.setupGuide.browser.test.tsx:20` - Narrow setup actions and transition back to the existing draft.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSettingsSurface.presentation.browser.test.tsx:63` - Real controls, localized container layouts, themes, and keyboard saving.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.settings.browser.test.tsx:24` - Browser discovery, explicit connection, and retained failed-connection input.
