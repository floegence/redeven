---
type: Interaction Contract
title: macOS application menu scope
tags: [applications, macos, menus, interaction]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

The helper exposes single-app menus, removing Apple/cross-app visibility branches before handles exist. Keep native titles literal. Only an enabled current leaf with verified live ancestry executes; stale/rejected actions retain app/capture and localized errors. Inspect menus only on explicit requests/actions, never launch/first frame.

# Contract

## Native menu projection
Read the bound application's main AX menu bar. macOS reserves its leading entry for the system Apple menu; omit that subtree structurally, independently of its title, host language or application name.

Empty, fully filtered or truncated submenus must never turn into executable leaf actions.

The application name is the first exposed menu group; there is no separate system-menu replacement or permanent warning.

## Handle lifetime and execution
Menu handles bind to the current application and capture/wait generation.

Removed, relocated, newly excluded, disabled or non-leaf items fail without being pressed.

The [native session contract](macos-host-applications.md) owns capture, input and window generations; this policy does not expand capture to other processes.

# Boundaries

Accessibility does not describe every command's effects. Direct local native launch keeps the host's normal macOS menu bar unchanged.

# Evidence

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplicationMenu.swift`: one owner for scoped projection, handles and live ancestry validation.

- `desktop/native/computer-host/Sources/RedevenComputerHost/HostApplications.swift`: application/generation binding and lifecycle invalidation.

- `scripts/check_macos_host_application_waiting.py --scenario menu_scope` and `scripts/fixtures/nativeHostApplication.swift`: real Apple-menu exclusion, windowless window creation, disabled/container/unknown/refreshed handles and live menu mutations using harmless sentinels.
