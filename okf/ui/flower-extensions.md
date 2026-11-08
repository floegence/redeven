---
type: UI Contract
title: Flower extensions
tags: [ui, flower, skills, mcp, plugins]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Shared Flower retains Skills/MCP/Plugins management through typed authenticated carrier adapters. MCP edits HTTP endpoints or local executable/one-argument-per-line. Never prefill secrets: omission preserves, explicit empty object clears. Retain search/enabled filter/tools/checks/confirmed removal.

# Contract

## Navigation
One title/return header and separate icon tab bar serve Skills/MCP/Plugins. Persistent selected underline and Arrow/Home/End support keyboard use. Panels start with compact filter/actions, not repeated titles. Keep check timestamps in details. Decorative32px row icons preserve names/heights; no untrusted SVG/icon-only actions. [MCP icons](../ai/mcp-runtime.md#presentation-icons) owns discovery/storage.

## Skills and MCP
Usable connections load source/catalog metadata. Serialize reads/mutations against stale refresh; read-only browsing never installs bundled files.

Default form shows connection type and endpoint or executable/arguments. Advanced holds optional name/ID with Automatic; existing IDs are read-only/selectable. Runtime allocates names/IDs, never client slugs. Add server creates; Save edits. Remote needs no introductory prose; enabled local saves explain execution once. Failure keeps drafts; reopening resets disclosure.

## Agent Plugins
Without sources show installed management directly: no Installed/Discover, official placeholders or discovery requests. With sources show distinct high-contrast view control and responsive cards. Keep separate searches/selected source; entering Discover loads it, switching/leaving fences late replies. Primary/local tabs differ visually. Omit raw environment IDs/repeated headings/introductory copy.

Empty Skills/MCP/Plugins use a concise factual title/direct action, without marketing, paragraphs or dashed frames. Installed search needs entries; configured discovery search remains during loading. Misses offer Clear filters. Cards open one detail dialog prioritizing description/enable/components; disclose hashes/configuration. Gallery avoids duplicate management. Keep execution/destruction consequences at the decision. Light/dark/narrow layouts remain readable without horizontal overflow.

Preparation/review/commit stay separate. Closing pending preview fences late polls while operation remains resumable. Failed requests keep input. Select components/enable explicitly; preparation executes nothing. Credentials use named password fields/replace/explicit clear, never returned secrets. Uninstall confirms separately, retaining data by default.

Owned Skills/MCP navigate repeatedly to plugin management rather than standalone mutations. Plugin changes invalidate mounted catalogs without resetting tabs/filters; late replies cannot reopen dismissed dialogs. Reader/admin/process permissions stay independent.

Manage sources is separate: admin-only mutations, retained failed input, Runtime-managed sources cannot be removed. Last removal returns installed view. Failure offers Retry, distinct from successful empty/search-miss. Metadata is inert, never approval. Cards enter existing preparation/review; package manifest owns preview. No official catalog. [Catalogs](../ai/flower-plugin-catalogs.md) owns activation/schema; [plugins](../ai/flower-agent-plugins.md) owns format/storage/update/permission.

# Boundaries

Nested Skills/MCP/Plugin editors and confirmations follow host presence and the selected supported category/tab. Hidden portals retain drafts; invalid resources cannot leave an active editor above an unavailable state.

Visibility grants no mutation. [MCP runtime](../ai/mcp-runtime.md) owns persistence, protocol, dependency matching and execution authority.

# Evidence

- `internal/flower_ui/src/FlowerSurface.tsx`
- `internal/flower_ui/src/extensions/FlowerExtensionsSurface.tsx`
