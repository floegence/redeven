---
type: UI Contract
title: Flower working directory navigation
tags: [ui, flower, filesystem, terminal, workbench]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Flower owns draft/thread directory intent; Env App destination navigation. Full-page selects/browses directory, companion omits it. Menus freeze thread/path. Activity opens Files/new Terminal; Workbench creates widgets without scaling canvas or injecting existing-shell commands.

# Contract

[Directory selection](filesystem-picker-navigation.md) owns validation; this contract owns entry points and destinations.

## Header and new-conversation entry points
The full-page header has a borderless folder/name browse button; new-conversation welcome selects the draft directory without persistent full-path secondary text. Only picker confirmation remembers a validated real directory. Browsing, cancellation, suggestions and destination navigation never write it; created-thread directories remain immutable.

The [conversation sidebar](flower-thread-sidebar.md#directory-view) can start a new draft from a listed directory. This supplies a draft-only directory override and follows normal admission validation; it does not remember a new personal default or modify an existing conversation.

## Directory and menu ownership
Right-click captures its row's thread/directory without loading, selecting or acknowledging it. Updates cannot retarget actions; handled child events cannot open outer menus. Copy/cancel restores valid triggers without scrolling.

Conversation transcript and thread-list menus expose browsing, opening a terminal, and copying the working directory. They never expose directory Favorite or Unfavorite actions; thread pinning remains a separate conversation action. Directory favorites belong to filesystem surfaces and the directory picker.

Menu actions use concise localized verbs without repeating the conversation or working-directory context: "Reference", "Copy ID", "Open folder", "Open terminal", "Copy path", "Copy", "Pin"/"Unpin", "Stop", and "Delete". The directory section retains its target path; permission explanations and deletion confirmations stay explicit. Env App and Desktop share the same labels in every shipped locale.

Directory actions retain real icons and aligned labels. Their current labels fit one line in every shipped locale; longer future labels can wrap within the menu instead of introducing horizontal scrolling. Browser visual acceptance uses the published icons and floating layer.

## Destination behavior
Activity Files reuses its singleton window/geometry; Terminal creates a new session. Workbench creates the matching widget. Request IDs, lazy loading, terminal admission and layout persistence retain ownership. Created-thread browsing includes ThreadID; menu/terminal actions require it.

## Availability and recovery
Browsing and Terminal availability are separate. Disabled reasons/errors are explicit; rejected terminal paths cannot silently fall back to Home. Existing transport, process, authorization and persistence owners remain; Flower adds no queue, lifecycle mirror or retry owner.

# Boundaries

Directory callbacks express product navigation, not file-action authorization or AI execution.

[Surface lifecycle](workbench-composition.md#surface-lifetime), [terminal interaction](workbench-terminal-interaction.md) and [Activity companion](flower-activity-companion.md#companion) own destination placement and retained product state.

# Evidence

- `redeven:internal/flower_ui/src/threads/FlowerThreadList.tsx` - Source.
- `redeven:internal/flower_ui/src/chat/FlowerWorkingDirectoryControl.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.directoryMenus.browser.test.tsx` - Tests.
