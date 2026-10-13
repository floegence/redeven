---
type: UI Contract
title: Flower setup and settings
description: First-time model setup, actionable starter tasks, and shared provider, permission, and computer settings.
tags: [ai, flower, settings, onboarding]
timestamp: 2026-10-13T05:08:00Z
---
# Summary

The shared Flower surface owns setup and settings for Desktop and Env App.
An empty profile without a usable model or selected conversation offers explicit
setup actions. Configured new conversations offer starter tasks as editable
drafts; selecting one never launches a turn. Settings use flat sections and
preserve drafts, model-source identity and permission ownership. Connection
failures and configured profiles needing repair retain their recovery controls.
Chat stays mounted across panel switches. Inactive panels cannot paint, receive
input, or acknowledge reads; settings save progress and errors survive hiding.

# Contract

## First-time setup

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

## Starter tasks

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

## Settings composition

Settings edit the environment profile even with a Desktop model source.
Four accessible peer sections present model, providers, permission, and computer
controls; localized headings and descriptions precede each group. The centered
frame is at most 860px, with a 25px title and 40px side padding that contracts to
16px below 760 CSS pixels. Provider rows share a 14px-radius divided group.

Desktop Flower, embedded Env Flower, and Env App global settings share
`FlowerModelSettings`; hosts retain persistence and authorization ownership.
The model group presents identity above evenly sized columns for inputs, context,
output, and default reasoning. Columns use the full width and become two columns
on narrow screens. The edit action opens a searchable Floe dialog, grouped by enabled provider.
Each choice shows its model identifier, inputs and declared token limits, with the
current default marked explicitly. Search matches provider identity, model names
and wire identifiers; an empty result preserves the search and offers no choice.
The list scrolls independently of the search field. Arrow keys, Home and End
move between choices; Enter selects a focused choice or a sole search result.
Selection retains the host save behavior. Escape, the close control and backdrop
dismiss without saving, clear search, and restore edit-action focus. Unavailable
models remain excluded and reselecting the current default does not save.

Provider rows place identity and model count left, useful availability status
right, and an enable switch with edit/remove actions at the trailing edge.
Authentication-method and optional-key labels do not appear in the list. The
count expands a full-width semantic table, with one row per model and labeled
columns for identity, input capabilities, declared context/output limits and exact
model-level web-search status. The table uses the shared panel surface with thin
horizontal rules after its header and between model rows. A compact check badge
marks the current model beside its name; the identifier remains secondary below
it. Unavailable models remain explicit; missing token limits show a dash. Narrow screens scroll only the
table inside its own keyboard-focusable region. Provider status moves below
identity on narrow layouts; adding a provider stays in the heading. Switch saves
are immediate, block duplicate edits, and restore the previous state on failure.
Disabled defaults remain visible with guidance to enable or choose a replacement;
only enabled providers contribute model choices. Retention and admission rules
belong to [model selection](../ai/model-directory-and-selection.md).

Permission choices remain visible as one divided vertical radio group, with a
check indicator and no additional selection border. Long translations must wrap
without covering adjacent values. Controls retain keyboard focus and pointer affordances under the published Floe focus contract.

Computer use remains a separately saved switch with a visible thumb in both
themes. Its management destination shares the same group as a full-width action
row. The self-managed Chromium connection form is an expandable advanced
section; collapsing it does not destroy its address or connection result.
Discovery, profile/tab selection, and explicit connection retain their existing
runtime operations. The shared settings panel stays mounted when returning to chat.

## Provider configuration

Provider layout, authentication choices, and connection-before-model sequencing
belong to [Flower provider configuration](flower-provider-configuration.md).

## Retained panels

FlowerSurface owns one active chat/settings/extensions panel. Chat and its
ordinary textarea remain mounted; settings and extensions load on first visit
and remain mounted afterwards. Native `hidden`, `inert`, and `aria-hidden`
exclude inactive panels from paint, pointer input, keyboard focus and accessible
navigation. Hidden chat does not acknowledge transcript reads. Switching panels
preserves the selected thread, draft, selection, IME, form choices, extension
filters and tabs, pending saves and errors without adding a connection or state
copy. Optional header trailing actions let hosts supply their existing controls.

The [Activity companion contract](flower-activity-companion.md#stable-flower-placement)
owns the complete-collapse reset and explicit shortcut activation. Returning to
chat through that reset does not discard the previously visited settings form.

## Saving and ownership

The adapter exposes independent `saveDefaultPermission`, `saveModelProfile`, and
`persistDefaultModel` operations. Provider dialogs and provider switches save directly; model choices
and default permissions retain their host save behavior. Default
permission uses a serialized 700 ms controller that coalesces rapid changes,
protects newer choices from older responses, and restores the last confirmed
value on failure. It applies to new conversations only. Existing-thread defaults
and admitted turns remain governed by the [model and navigation contract](flower-model-navigation.md).
Computer-use save failures restore the confirmed switch and expose the error.

# Boundaries

Starter-task selection creates an editable draft, never a turn. Settings preserve drafts, model-source identity and permission ownership. Connection failures and configured profiles needing repair use their recovery controls rather than the first-time setup presentation.

Settings fields follow the shared [product field treatment](runtime-settings.md#settings-controls-and-identity), and provider identities use the corresponding shared brand icon. Permission descriptions sit outside the single-line selection buttons and are linked through accessible descriptions; arrow-key selection and autosave retain their existing owner.

# Evidence

- `redeven:internal/flower_ui/src/i18n/flowerSurfaceMessages.ts` - Canonical localized task copy and complete seeded prompts.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.starterTasks.browser.test.tsx` - Localized card layout, complete draft insertion, keyboard and pointer focus handoff, and no automatic submission.
- `redeven:desktop/src/welcome/flower/desktopFlowerSurfaceCopy.test.tsx` - Desktop and shared English starter-copy parity.
- `redeven:internal/envapp/ui_src/src/ui/FlowerWorkingDirectory.browser.test.tsx` - One-shot welcome rotation, overshoot, stable draft edits, and reduced motion.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx:2846` - First-time setup eligibility and retained composer ownership.
- `redeven:internal/flower_ui/src/chat/FlowerSetupWelcome.tsx:7` - Setup destinations and model refresh presentation.
- `redeven:internal/flower_ui/src/settings/FlowerSettingsSurface.tsx` - Shared settings actions and save controllers.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.setupGuide.browser.test.tsx:20` - Narrow setup actions and transition back to the existing draft.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSettingsSurface.presentation.browser.test.tsx:63` - Real controls, localized container layouts, themes, and keyboard saving.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.settings.browser.test.tsx` - Browser discovery, explicit connection, and retained failed-connection input.
- `redeven:internal/flower_ui/src/settings/FlowerModelSettings.tsx` - Shared model/provider presentation and transient edit ownership.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/FlowerSection.browser.test.tsx` - Global Env layout, provider persistence, rollback, account retention, and reader controls.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.companionPanels.browser.test.tsx` - Retained settings and extensions, editor identity, focus exclusion, save outcomes, and published companion phases.
