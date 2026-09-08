---
type: UI Contract
title: Flower working directory navigation
description: Open a conversation's working directory in Files or Terminal from consistent Flower menus.
tags: [ui, flower, filesystem, terminal, workbench]
timestamp: 2026-09-08T00:00:00Z
---
# Summary

Flower owns the conversation target and menu intent; Env App owns Activity and
Workbench navigation. Right-clicking a conversation row, its more button, or the
current transcript exposes the same working-directory actions. Each open menu
captures the target thread ID and directory, so summary replacement cannot
retarget an action or select a different conversation. Activity opens the shared
Files floating window or a new Terminal session. Workbench creates a new Files
or Terminal widget at the viewport center, preserving scale. Runtime remains
the filesystem and process authorization authority. Unavailable directories or
permissions produce explicit disabled reasons or the existing destination error
presentation; opening never injects commands into an existing shell.

# Contract

## Directory and menu ownership

The row menu uses the right-clicked conversation's working directory without
loading, selecting, or acknowledging that conversation. The transcript uses the
identity-matching loaded conversation detail. A pending detail has no usable
directory, and a new composer without a conversation has no directory actions.
Neither draft nor Home nor text inside a message can substitute for the target.

An open row menu retains its ThreadID identity across summary updates and row
replacement. Status and title may refresh, while directory actions, including
copy, use the path captured when the menu opened. Existing row-menu lifecycle
events still close it; hiding its Flower surface also closes it. Switching the
current conversation, hiding the transcript, or leaving chat closes the
transcript menu. Navigation actions do not acquire the thread-mutation busy
state and remain available while a conversation is running or awaiting input.

Transcript menus snapshot only a real text selection whose endpoints are both
inside that transcript. Copy preserves the exact text after menu focus changes.
Links, editable controls, independent menu owners, and terminal output keep
their own context-menu behavior. A handled child event never opens an outer
menu. Automatic transcript scrolling does not dismiss its menu; user wheel,
touch scrolling, or an outside pointer gesture does. Message delivery and
transcript following continue through their existing owners.

Flower row and transcript menus share one Flower presentation component over
the published SurfaceFloatingLayer. Pointer, more-button, and keyboard entry
retain projected placement, keyboard navigation, Escape/Tab dismissal, and
focus restoration. Disabled directory actions remain keyboard-readable with
an accessible reason. Successful open actions hand focus to the destination;
Flower cannot reclaim it after dispatch. Copy and canceled menus restore their
valid trigger without scrolling.

## Destination behavior

Activity Files uses the existing singleton floating window and its persisted
geometry. Each explicit open focuses the window and activates its existing stack
entry; reopening updates the directory without replacing the window geometry.
Closing restores a connected, visible origin captured before the handoff. Activity Terminal selects
the Terminal surface and requests a new session with the directory as
`workingDir`, using the destination panel's existing group. Its name defaults
to the directory basename. Existing terminal sessions receive no input.

Workbench uses `create_new` for both widget types. Each deliberate invocation
creates a separate component at the current viewport center and focuses it
without changing scale. Terminal's explicit `workbenchAnchor: null` suppresses
the host's recent-pointer anchor; an omitted anchor retains the preexisting
contextual handoff behavior for other callers. Existing request IDs, lazy body
loading, terminal widget admission, and layout persistence remain authoritative.

These actions use dedicated optional FlowerSurfaceAdapter callbacks. Canonical
tool file actions and linked-file navigation retain their own authorization and
reuse contracts; their callbacks are not repurposed for conversation directories.
The adapter promise acknowledges host dispatch, not completed filesystem loading
or process activation. Destination components own progress, errors, and retry.

## Availability and recovery

The host exposes separate availability for browsing and opening terminals.
Browsing requires a connected environment with read permission. Terminal launch
requires the existing read, write, and execute permissions. Availability is
rechecked at dispatch, independently of AI mutation permission. Unsupported
callbacks omit their menu entries. Copying a known path does not require a new
filesystem operation.

Runtime validates the requested directory and filesystem scope through the
existing APIs. A terminal cannot silently start in Home after a rejected path.
Files retains its existing directed-navigation failure and recovery display,
including the original requested path and any actual recovery directory. Shell
connection recovery and Workbench persistence follow their existing contracts;
Flower introduces no transport queue, process lifecycle mirror, database schema,
or retry owner.

# Boundaries

Directory callbacks express product navigation, not file-action authorization or
AI execution. These existing owners retain their respective boundaries:

- [Workbench surface lifecycle](workbench-surface-lifecycle.md) owns projected
  floating layers, lazy widgets, and connection recovery.
- [Workbench terminal interaction](workbench-terminal-interaction.md) owns
  terminal widget admission and session lifecycle.
- [Flower Activity companion](flower-activity-companion.md) owns Activity
  placement and retained Flower state during navigation.

# Evidence

- `redeven:internal/flower_ui/src/threads/FlowerThreadList.tsx` - ThreadID-owned
  row menus retain a captured working directory across summary replacement.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - Transcript selection,
  directory target resolution, capability dispatch, and destination focus handoff.
- `redeven:internal/envapp/ui_src/src/ui/flower/workingDirectoryNavigation.ts` -
  Host routing requests new components and explicitly centered terminals.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.directoryActions.test.tsx` -
  Cross-thread isolation, exact selection copying, and focus regression coverage.
- `redeven:internal/envapp/ui_src/src/ui/FlowerDirectoryMenus.browser.test.tsx` -
  Chromium coverage for transformed placement, snapshot stability, and keyboard entry.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.desktopFloatingSurfaces.e2e.test.tsx` -
  Activity dispatch and Workbench placement through the real shell controllers.
