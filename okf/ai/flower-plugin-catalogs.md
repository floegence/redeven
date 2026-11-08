---
type: Runtime Contract
title: Flower plugin catalog integration
tags: [ai, flower, plugins, discovery]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Flower can consume an explicitly configured plugin directory without shipping or maintaining a default index. Limits:16sources,1 MiB, IDs plugin-name syntax≤128characters, names nonempty single-line≤128Unicode, unique IDs/URLs. HTTPS host required; reject userinfo/query/fragment/unknown fields/malformed config explicitly.

# Contract

## Optional runtime configuration
REDEVEN_AGENT_AI_PLUGIN_CATALOGS is a runtime-process JSON array of {id, name, url}; unset/whitespace/[] means none. Example:team/Team extensions/https://catalog.example.com/plugins.json, never a default. Restart applies config. No official URL, startup fetch/search/remote switch/automatic enrollment.

Network checks occur only when browsing through bounded public distribution.

Configured sources use configured:<id>/managed:true and memory only. User UUID/CAS sources retain independent 16 limit. Configured URLs take display precedence without deleting user records; removal reveals retained source. User APIs cannot delete configured sources. Config changes do not revise installation registry or alter snapshots/credentials/data. Desktop/Web use authenticated runtime routes; renderer-only environment has no effect.

## Directory document
flower.agent_plugin_catalog.v1 contains directory id/plugins; entry{id, optional display, source{type:github, repository, ref, path}}. IDs follow plugin-name syntax≤128; unique entry IDs. Limits 128entries/1 MiB, reject overflow rather than truncate. Empty[] valid; missing/null arrays, unsupported schema, trailing JSON/unknown top-level-entry-source fields reject. display alone allows discarded additive fields:single-line name/author≤128Unicode, description≤512. Render text only, no HTML/badges/credentials/configuration. Incompatible changes need a new schema.

Existing public-GitHub normalizer validates repository/ref/commit/path (default .). Different repository paths stay independent installs. Catalog identity/removal never changes installed identity/state.

## Browse and install boundary
Browse reads bounded JSON only, no archive/preparation/process/enablement. Install invokes the existing manual-GitHub preparation:resolve exact revision, snapshot package, validate real manifest/components. Preview uses actual metadata, not directory claims; commit binds reviewed digest/explicit selection. Listing/topic/manifest is no endorsement.

Fetch failure exposes Retry, not empty success. Unconfigured/unavailable/removed discovery cannot affect installed management/execution. [Extensions](../ui/flower-extensions.md) owns UI; [Agent Plugins](flower-agent-plugins.md) owns snapshots/permissions.

# Boundaries

No hosting, content index, scheduled crawler, publication portal, rankings, authentication onboarding or native `.redevplugin` market changes are included. Redeven owns this distribution/presentation boundary and continues consuming published upstream components. Plugin authors need no Flower-specific folder. A future GitHub topic convention is not an implemented discovery promise.

# Evidence

- `internal/ai/agentplugins/catalog_test.go`

- `internal/ai/agent_plugin_catalog_test.go`

- `internal/envapp/ui_src/src/ui/flower/FlowerExtensions.browser.test.tsx` covers default absence, configured browsing, failure/retry, source management, actual preview metadata, responsive layouts and retained state.
