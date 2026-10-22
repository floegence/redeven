---
type: UI Contract
title: Flower Skills and MCP
description: Manage Flower instructions and external tools from one retained two-tab surface in both product carriers.
tags: [ui, flower, skills, mcp]
timestamp: 2026-09-29T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Shared Flower UI owns the Skills and MCP management page. Env App and Desktop
supply the same typed, authenticated management adapter. The `Skills·MCP` entry
sits immediately below New chat in the conversation rail; runtime settings have
no separate Skills destination. Opening management preserves the unsent chat
draft, and each tab retains its filters while the surface remains mounted.
Readers can inspect skills and server catalogs but cannot mutate administrator
configuration. Failed operations keep their input and offer an explicit retry.

# Contract

## Navigation and presentation
The page has one identity header, a return-to-chat action, and two accessible Skills/MCP tabs with arrow, Home, and End navigation.

Both carriers resolve explicit copy for every shipped locale, including plural counts and locale-aware check timestamps.

## Entry icons
Every skill and MCP row reserves a 32px icon beside its name without increasing row height. Icons are decorative, retain the adjacent accessible name, and never become interactive targets or inline untrusted SVG markup.

MCP discovery and persistence follow [the runtime icon contract](../ai/mcp-runtime.md#presentation-icons).

## Skills
Catalog and source metadata load once the connection is usable.

Catalog refresh and mutations are serialized so an older read cannot overwrite a successful change.

Browsing requires read access and never installs bundled files on disk.

## MCP
Add or edit a server using a remote HTTP endpoint or a local executable with one argument per line. Existing secret values are never filled into a form; omission keeps them and an explicit empty object clears them.

Search, enabled filtering, discovered tool details, explicit connection checks, and confirmed removal are available from the MCP tab.

# Boundaries

Catalog visibility does not grant mutation authority: readers can inspect, while configuration changes require administrator access through the authenticated management adapter. See [the MCP runtime contract](../ai/mcp-runtime.md) for persistence, protocol, dependency matching, and execution authorization.

# Evidence

- `internal/flower_ui/src/FlowerSurface.tsx` owns rail placement and chat return.

- `internal/flower_ui/src/extensions/FlowerExtensionsSurface.tsx` and   `internal/flower_ui/src/extensions/extensions.css` own retained tabs and layout.

- `internal/flower_ui/host/extensionsAdapter.ts` maps typed management actions.
