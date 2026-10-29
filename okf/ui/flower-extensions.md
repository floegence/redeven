---
type: UI Contract
title: Flower extensions
tags: [ui, flower, skills, mcp, plugins]
lifecycle: contract
reviewed_at: "2026-10-29"
---
# Summary

Shared Flower owns retained Skills/MCP/Plugins management; both carriers supply typed authenticated adapters. The rail entry below New chat preserves draft/tab filters, with no duplicate runtime Skills destination. Readers inspect catalogs; administrators mutate configuration. Failures retain input and expose Retry, and every shipped locale supplies explicit copy.

# Contract

## Navigation and presentation
One header owns the title and return action; a separate primary tab bar uses distinct Skills/MCP/Plugins icons and a persistent selected underline. Arrow/Home/End navigation and focus remain accessible. Each panel begins with one compact filter/action toolbar instead of repeating its tab title. Preserve check timestamps in entry details.

## Entry icons
Decorative 32px row icons retain names and row height; never inject untrusted SVG or create icon-only targets. [MCP runtime](../ai/mcp-runtime.md#presentation-icons) owns discovery/persistence.

## Skills
Usable connections load catalog/source metadata. Serialized reads/mutations prevent stale refresh overwrite. Read-only browsing never installs bundled files.

## MCP
Edit remote HTTP endpoints or local executables with one argument per line. Never prefill secrets: omitted values preserve, explicit empty object clears. Search, enabled filter, discovered tools, explicit checks and confirmed removal remain available.

The default MCP form contains connection type and endpoint, or executable and arguments. Name and server ID are optional fields inside Advanced, with an Automatic placeholder. Existing IDs remain read-only and selectable. The runtime owns naming and ID allocation; submitting an unnamed connection needs no client-side slug. The primary creation action is Add server, while edits use Save. Omit introductory prose for remote connections; enabled local connections disclose command execution in one sentence at the save decision. Failed submissions retain all draft fields and reopening a dialog resets the disclosure.

## Agent Plugins
The Plugins destination presents installed management directly when no catalog source is configured; omit the Installed/Discover control, official-directory placeholders and discovery requests. With sources, show the high-contrast Installed/Discover control and a responsive card gallery. Keep independent installed/discovery search values and the selected source across view changes. Opening Discover loads the selected source automatically; switching sources or leaving discovery invalidates older responses. Primary tabs and local view controls have distinct visual treatments. Omit introductory prose, raw environment identifiers and repeated headings from the landing surface. Empty libraries show a short factual title and direct actions; installed search appears only when there are entries to search; discovery search remains available while a configured catalog loads. Filter misses show Clear filters instead of installation guidance. Selecting a card opens one focused detail dialog: description, enable control and components first; install hashes and connection configuration remain in disclosures. Avoid repeating management controls in the gallery. The plugin empty state supplies one install action; no marketing headline, explanatory paragraph or dashed placeholder frame competes with it. Skills and MCP use the same concise empty-state pattern. Preserve execution and destructive-action explanations at their relevant decision point. Both light/dark themes and narrow screens preserve readable controls without horizontal overflow.

Preparation, preview and commit are distinct. Closing a pending preview never reopens it when an older poll completes; its operation remains resumable. Failed requests retain input. Component selection and enablement are explicit; package preparation never executes commands. Credential editing uses named password fields, replacement and explicit clearing, never returned secret values. Uninstall confirms separately and retains data by default.

Package-owned Skills/MCP entries navigate to their owning plugin instead of offering standalone mutation. Reopening the same owner works repeatedly. Plugin mutations invalidate mounted Skill/MCP catalogs without resetting filters or tabs. Async responses do not override dismissed dialogs. Reader/admin and process-execution capabilities remain independent.

Manage sources is a focused dialog outside browsing; retain failed input, restrict mutations to administrators, and mark runtime-managed sources without offering removal. Removing the last source returns to installed management. Catalog failure shows Retry, not an empty catalog; successful empty catalogs and search misses remain distinct. Names, descriptions and authors are inert presentation metadata, not approval claims. Catalog cards enter the existing source preparation and review flow; the actual package manifest owns the preview. No official catalog is supplied. [Catalog integration](../ai/flower-plugin-catalogs.md) owns activation and schema rules. [The runtime contract](../ai/flower-agent-plugins.md) defines format, storage, updates and permission boundaries.

# Boundaries

Catalog visibility does not grant mutation authority: readers can inspect, while configuration changes require administrator access through the authenticated management adapter. See [the MCP runtime contract](../ai/mcp-runtime.md) for persistence, protocol, dependency matching, and execution authorization.

# Evidence

- `internal/flower_ui/src/FlowerSurface.tsx` owns rail placement and chat return.

- `internal/flower_ui/src/extensions/FlowerExtensionsSurface.tsx` and   `internal/flower_ui/src/extensions/extensions.css` own retained tabs and layout.

- `internal/flower_ui/host/extensionsAdapter.ts` maps typed management actions.
