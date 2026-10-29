---
type: UI Contract
title: Flower Skills and MCP
tags: [ui, flower, skills, mcp]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Shared Flower owns retained Skills/MCP management; both carriers supply typed authenticated adapters. The rail entry below New chat preserves draft/tab filters, with no duplicate runtime Skills destination. Readers inspect catalogs; administrators mutate configuration. Failures retain input and expose Retry, and every shipped locale supplies explicit copy.

# Contract

## Navigation and presentation
One header/return action serves accessible Skills/MCP tabs with arrow/Home/End navigation, localized plural counts and check timestamps.

## Entry icons
Decorative 32px row icons retain names and row height; never inject untrusted SVG or create icon-only targets. [MCP runtime](../ai/mcp-runtime.md#presentation-icons) owns discovery/persistence.

## Skills
Usable connections load catalog/source metadata. Serialized reads/mutations prevent stale refresh overwrite. Read-only browsing never installs bundled files.

## MCP
Edit remote HTTP endpoints or local executables with one argument per line. Never prefill secrets: omitted values preserve, explicit empty object clears. Search, enabled filter, discovered tools, explicit checks and confirmed removal remain available.

# Boundaries

Catalog visibility does not grant mutation authority: readers can inspect, while configuration changes require administrator access through the authenticated management adapter. See [the MCP runtime contract](../ai/mcp-runtime.md) for persistence, protocol, dependency matching, and execution authorization.

# Evidence

- `internal/flower_ui/src/FlowerSurface.tsx` owns rail placement and chat return.

- `internal/flower_ui/src/extensions/FlowerExtensionsSurface.tsx` and   `internal/flower_ui/src/extensions/extensions.css` own retained tabs and layout.

- `internal/flower_ui/host/extensionsAdapter.ts` maps typed management actions.
