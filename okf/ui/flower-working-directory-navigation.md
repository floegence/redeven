---
type: UI Contract
title: Flower working directory navigation
description: Select a new Flower draft directory and browse its files from the header, with shared conversation menu navigation.
tags: [ui, flower, filesystem, terminal, workbench]
timestamp: 2026-10-21T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Flower owns draft and conversation directory intent; Env App owns Activity and
Workbench navigation. The full-page header browses the displayed directory, and the
full-page new-conversation welcome selects the draft directory. The floating
companion omits both directory controls while retaining the same draft and
runtime execution directory. Created directories stay
immutable. Row and transcript menus capture the exact thread and directory;
updates cannot retarget actions. Activity opens Files or a new Terminal session;
Workbench creates the corresponding widget without changing scale. Runtime
retains filesystem and process authorization. Unavailable targets show explicit
disabled reasons or destination errors, and opening never injects commands into
an existing shell.

# Contract

Directory validation and selection state are owned by [absolute filesystem directory selection](filesystem-picker-navigation.md). This concept owns Flower entry points and destination navigation.

## Header and new-conversation entry points
The full-page top-right header uses a compact, borderless folder-and-name button to browse the current directory. Confirming the picker remembers only the validated real directory for future new conversations; browsing, cancellation, recent-thread suggestions, and Files/Terminal navigation never write it.

Full paths are not permanent secondary text in the welcome area.

## Directory and menu ownership
The row menu uses the right-clicked conversation's working directory without loading, selecting, or acknowledging that conversation.

A handled child event never opens an outer menu.

Copy and canceled menus restore their valid trigger without scrolling.

## Destination behavior
Activity Files uses the existing singleton floating window and its persisted geometry.

Existing request IDs, lazy body loading, terminal widget admission, and layout persistence remain authoritative.

Created-conversation browsing includes its thread ID; menu actions and terminal launch still require a conversation identity.

## Availability and recovery
The host exposes separate availability for browsing and opening terminals.

A terminal cannot silently start in Home after a rejected path. Shell connection recovery and Workbench persistence follow their existing contracts; Flower introduces no transport queue, process lifecycle mirror, database schema, or retry owner.

# Boundaries

Directory callbacks express product navigation, not file-action authorization or AI execution.

- [Workbench surface lifecycle](workbench-surface-lifecycle.md) owns projected   floating layers, lazy widgets, and connection recovery. - [Workbench terminal interaction](workbench-terminal-interaction.md) owns   terminal widget admission and session lifecycle. - [Flower Activity companion](flower-activity-companion.md) owns Activity   placement and retained Flower state during navigation.

# Evidence

- `redeven:internal/flower_ui/src/threads/FlowerThreadList.tsx` - ThreadID-owned   row menus retain a captured working directory across summary replacement.

- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Transcript selection,   draft and conversation target resolution, capability dispatch, and destination focus handoff.

- `redeven:internal/flower_ui/src/chat/FlowerWorkingDirectoryControl.tsx` -   Shared accessible header and selector presentation with suffix-preserving names.
