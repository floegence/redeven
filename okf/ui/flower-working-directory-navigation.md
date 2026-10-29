---
type: UI Contract
title: Flower working directory navigation
tags: [ui, flower, filesystem, terminal, workbench]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Flower owns draft/durable-thread directory intent; Env App owns destination navigation. Full-page controls select new draft directories or browse the current directory; the companion omits them. Menus freeze exact thread/directory targets. Activity opens Files/new Terminal; Workbench creates widgets without changing scale or injecting commands into existing shells.

# Contract

[Directory selection](filesystem-picker-navigation.md) owns validation; this contract owns entry points and destinations.

## Header and new-conversation entry points
The full-page header has a borderless folder/name browse button; new-conversation welcome selects the draft directory without persistent full-path secondary text. Only picker confirmation remembers a validated real directory. Browsing, cancellation, suggestions and destination navigation never write it; created-thread directories remain immutable.

## Directory and menu ownership
Right-click captures its row's thread/directory without loading, selecting or acknowledging it. Updates cannot retarget actions; handled child events cannot open outer menus. Copy/cancel restores valid triggers without scrolling.

## Destination behavior
Activity Files reuses its singleton window/geometry; Terminal creates a new session. Workbench creates the matching widget. Request IDs, lazy loading, terminal admission and layout persistence retain ownership. Created-thread browsing includes ThreadID; menu/terminal actions require it.

## Availability and recovery
Browsing and Terminal availability are separate. Disabled reasons/errors are explicit; rejected terminal paths cannot silently fall back to Home. Existing transport, process, authorization and persistence owners remain; Flower adds no queue, lifecycle mirror or retry owner.

# Boundaries

Directory callbacks express product navigation, not file-action authorization or AI execution.

[Surface lifecycle](workbench-surface-lifecycle.md), [terminal interaction](workbench-terminal-interaction.md) and [Activity companion](flower-activity-companion.md) own destination placement and retained product state.

# Evidence

- `redeven:internal/flower_ui/src/threads/FlowerThreadList.tsx` - ThreadID-owned   row menus retain a captured working directory across summary replacement.

- `redeven:internal/flower_ui/src/chat/FlowerWorkingDirectoryControl.tsx` -   Shared accessible header and selector presentation with suffix-preserving names.
