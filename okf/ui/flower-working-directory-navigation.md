---
type: UI Contract
title: Flower working directory navigation
description: Select a new Flower draft directory and browse its files from the header, with shared conversation menu navigation.
tags: [ui, flower, filesystem, terminal, workbench]
timestamp: 2026-09-21T00:00:00Z
---
# Summary

Flower owns draft and conversation directory intent; Env App owns Activity and
Workbench navigation. The header browses the displayed directory, and the
new-conversation welcome selects the draft directory. Created directories stay
immutable. Row and transcript menus capture the exact thread and directory;
updates cannot retarget actions. Activity opens Files or a new Terminal session;
Workbench creates the corresponding widget without changing scale. Runtime
retains filesystem and process authorization. Unavailable targets show explicit
disabled reasons or destination errors, and opening never injects commands into
an existing shell.

# Contract

Directory validation and selection state are owned by [absolute filesystem directory selection](filesystem-picker-navigation.md). This concept owns Flower entry points and destination navigation.

## Header and new-conversation entry points

The top-right header uses a compact, borderless folder-and-name button to browse
the current directory. Clicking it neither copies the path nor edits the draft.
The current draft uses its selected directory or the runtime-declared default
root. A selected conversation uses only its identity-matching loaded detail:
pending or missing detail cannot substitute a previous, draft, or Home path.
An unavailable target or browse capability disables the button with an explicit
reason. Successful dispatch hands focus to Files; a dispatch failure reports the
error and restores the connected header origin.

Before creation, the welcome area places a muted working-directory label beside
a blue folder/name/chevron selector. It opens the existing directory picker at
the current draft path. A Recently used tab beside Home/Root offers up to three
unique recent root-conversation directories ranked by update time. [Picker navigation](filesystem-picker-navigation.md)
owns validation; only confirmation updates the draft. Cancellation keeps
it unchanged and restores the selector. The selector is absent after creation.
The composer footer and More panel contain no working-directory control.

Both entries adapt to available width. Long names truncate in the middle while
retaining their identifying suffix, and full absolute paths remain available in
the accessible label and tooltip. The selector uses blue in light and dark
themes, a faint hover surface, and a visible keyboard focus outline. Full paths
are not permanent secondary text in the welcome area.

## Directory and menu ownership

The row menu uses the right-clicked conversation's working directory without
loading, selecting, or acknowledging that conversation. The transcript uses the
identity-matching loaded conversation detail. A pending detail has no usable
directory, and a new composer without a conversation has no transcript directory menu.
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
Draft browsing passes an absolute path without a thread ID. Created-conversation
browsing includes its thread ID; menu actions and terminal launch still require
a conversation identity.

## Availability and recovery

The host exposes separate availability for browsing and opening terminals.
Browsing requires a connected environment with read permission. Terminal launch
requires the existing read, write, and execute permissions. Availability is
rechecked at dispatch, independently of AI mutation permission. Unsupported
callbacks omit their menu entries. Copying a known path does not require a new
filesystem operation.

Runtime validates the requested directory and filesystem scope through the
existing APIs. A terminal cannot silently start in Home after a rejected path.
Files uses the shared [filesystem navigation failure contract](filesystem-picker-navigation.md),
retaining the original requested path and offering explicit recovery actions. Shell
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
  draft and conversation target resolution, capability dispatch, and destination focus handoff.
- `redeven:internal/flower_ui/src/chat/FlowerWorkingDirectoryControl.tsx` -
  Shared accessible header and selector presentation with suffix-preserving names.
- `redeven:internal/envapp/ui_src/src/ui/flower/workingDirectoryNavigation.ts` -
  Host routing requests new components and explicitly centered terminals.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.directoryActions.test.tsx` -
  Cross-thread isolation, exact selection copying, and focus regression coverage.
- `redeven:internal/envapp/ui_src/src/ui/FlowerDirectoryMenus.browser.test.tsx` -
  Chromium coverage for transformed placement, snapshot stability, and keyboard entry.
- `redeven:internal/envapp/ui_src/src/ui/FlowerWorkingDirectory.browser.test.tsx` -
  Narrow layouts, Unicode paths, light/dark blue, and projected picker focus.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.directoryPicker.test.shared.tsx` -
  Header draft browsing, confirmation-only selection, and launch directory parity.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.desktopFloatingSurfaces.e2e.test.tsx` -
  Activity dispatch and Workbench placement through the real shell controllers.
