---
type: UI Contract
title: Flower extensions
tags: [ui, flower, skills, mcp, plugins]
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Shared Flower owns retained Skills/MCP/Plugins management; both carriers supply typed authenticated adapters. The rail entry below New chat preserves draft/tab filters, with no duplicate runtime Skills destination. Readers inspect catalogs; administrators mutate configuration. Failures retain input and expose Retry, and every shipped locale supplies explicit copy.

# Contract

## Navigation and presentation
One header/return action serves accessible Skills/MCP/Plugins tabs with arrow/Home/End navigation, localized plural counts and check timestamps.

## Entry icons
Decorative 32px row icons retain names and row height; never inject untrusted SVG or create icon-only targets. [MCP runtime](../ai/mcp-runtime.md#presentation-icons) owns discovery/persistence.

## Skills
Usable connections load catalog/source metadata. Serialized reads/mutations prevent stale refresh overwrite. Read-only browsing never installs bundled files.

## MCP
Edit remote HTTP endpoints or local executables with one argument per line. Never prefill secrets: omitted values preserve, explicit empty object clears. Search, enabled filter, discovered tools, explicit checks and confirmed removal remain available.

## Agent Plugins
The Plugins destination presents quiet Installed/Discover navigation, a search field and a responsive card gallery. Selecting a card opens one focused detail dialog: description, enable control and components first; install hashes and connection configuration remain in disclosures. Avoid repeating management controls in the gallery. Empty state supplies one install action. Both light/dark themes and narrow screens preserve readable controls without horizontal overflow.

Preparation, preview and commit are distinct. Closing a pending preview never reopens it when an older poll completes; its operation remains resumable. Failed requests retain input. Component selection and enablement are explicit; package preparation never executes commands. Credential editing uses named password fields, replacement and explicit clearing, never returned secret values. Uninstall confirms separately and retains data by default.

Package-owned Skills/MCP entries navigate to their owning plugin instead of offering standalone mutation. Reopening the same owner works repeatedly. Plugin mutations invalidate mounted Skill/MCP catalogs without resetting filters or tabs. Async responses do not override dismissed dialogs. Reader/admin and process-execution capabilities remain independent.

Discovery catalogs are explicit trusted sources, with preview required before installation. [The runtime contract](../ai/flower-agent-plugins.md) defines format, storage, updates and permission boundaries.

# Boundaries

Catalog visibility does not grant mutation authority: readers can inspect, while configuration changes require administrator access through the authenticated management adapter. See [the MCP runtime contract](../ai/mcp-runtime.md) for persistence, protocol, dependency matching, and execution authorization.

# Evidence

- `internal/flower_ui/src/FlowerSurface.tsx` owns rail placement and chat return.

- `internal/flower_ui/src/extensions/FlowerExtensionsSurface.tsx` and   `internal/flower_ui/src/extensions/extensions.css` own retained tabs and layout.

- `internal/flower_ui/host/extensionsAdapter.ts` maps typed management actions.
