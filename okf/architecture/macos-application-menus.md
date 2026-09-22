---
type: Interaction Contract
title: macOS application menu scope
description: Export native application commands without the system Apple menu and validate every executable handle against the live menu.
tags: [applications, macos, menus, interaction]
timestamp: 2026-09-22T09:00:00Z
---
# Summary

The macOS helper owns the menu exposed by a single-application viewer. It omits
the entire system Apple subtree and identified cross-application visibility
commands before issuing handles. Application titles remain literal native text.
Only an enabled leaf from the current snapshot, still under its allowed live
ancestry, can execute. Rejected or stale actions produce the existing localized
operation error and preserve the application and capture. Menu inspection happens
on explicit menu requests and actions, never on the launch or first-frame path.

# Contract

## Native menu projection

Read the bound application's main AX menu bar. macOS reserves its leading entry
for the system Apple menu; omit that subtree structurally, independently of its
title, host language or application name. Do not enumerate its descendants or
create executable handles for them. This also prevents Apple-menu Force Quit
from bypassing Redeven's explicit, confirmed application-management control.

Filter the native AX action identifiers `hideOtherApplications:` and
`unhideAllApplications:` wherever they occur in the remaining tree. Their effects
extend beyond the shared application. Preserve application commands such as
About, settings, file operations, creating windows, hiding the current app and
ordinary quit. Preserve disabled entries for explanation but give them no
executable handles. Empty, fully filtered or truncated submenus must never turn
into executable leaf actions.

The renderer displays only the helper's returned tree. Native titles are not
translated by Redeven or used as localized blacklists. Existing theme surfaces,
nested navigation, disabled states and arrow-key/Escape behavior remain shared
with the viewer toolbar. The application name is the first exposed menu group;
there is no separate system-menu replacement or permanent warning.

## Handle lifetime and execution

Menu handles bind to the current application and capture/wait generation. A new
snapshot, attempted action, capture transition, suspend or session termination
revokes prior executable handles. Container IDs support navigation only.

Before pressing a returned leaf, re-read the application's menu root and verify
each parent-child relationship, current exclusion policy and enabled state.
Removed, relocated, newly excluded, disabled or non-leaf items fail without being
pressed. This protects against native menu changes that do not replace a window
or otherwise advance the session generation. An unknown handle never becomes an
arbitrary AX target. App cancellation and unknown outcomes never trigger retries
or forced exit.

Windowless sessions retain the same allowed application menus, so a user can open
the first application window. Late responses cannot reopen a dismissed dropdown.
The [native session contract](macos-host-applications.md) owns capture, input and
window generations; this policy does not expand capture to other processes.

# Boundaries

Accessibility does not describe every command's effects. Arbitrary application
commands, Services providers and helper-process dialogs can open another process;
this menu projection is not an application sandbox or a promise to display those
external windows. Do not guess such effects from translated labels or silently
capture the host desktop. Empty service submenus are omitted under the same
non-executable-container rule. Direct local native launch keeps the host's normal
macOS menu bar unchanged.

# Evidence

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplicationMenu.swift`: one owner for scoped projection, handles and live ancestry validation.
- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplications.swift`: application/generation binding and lifecycle invalidation.
- `scripts/check_macos_host_application_waiting.py --scenario menu_scope` and `scripts/fixtures/nativeHostApplication.swift`: real Apple-menu exclusion, windowless window creation, disabled/container/unknown/refreshed handles and live menu mutations using harmless sentinels.
- `internal/envapp/ui_src/src/ui/services/macHostApplicationViewer.test.ts`: literal labels, nested keyboard navigation and generation-bound responses.
