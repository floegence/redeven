---
type: Runtime Contract
title: Flower plugin catalog integration
tags: [ai, flower, plugins, discovery]
lifecycle: contract
reviewed_at: "2026-10-29"
---
# Summary

Flower can consume an explicitly configured plugin directory without shipping or maintaining a default index. Runtime sources and user-managed sources use the same catalog reader and GitHub installation workflow. Catalog availability never owns installed plugin authority.

# Contract

## Optional runtime configuration

Set `REDEVEN_AGENT_AI_PLUGIN_CATALOGS` on the process hosting Flower to a JSON array, then restart that runtime. Unset, whitespace and `[]` mean no configured sources. No official URL, background catalog fetch, GitHub search, remote bootstrap or automatic enrollment is included.

```json
[
  {
    "id": "team",
    "name": "Team extensions",
    "url": "https://catalog.example.com/plugins.json"
  }
]
```

The example is illustrative, not a live default. Configuration allows at most 16 entries and 1 MiB. IDs follow plugin-name syntax with a 128-character limit; names are nonempty, single-line text up to 128 Unicode characters. IDs and URLs must be unique. URLs require HTTPS and a host; userinfo, queries and fragments are rejected. Unknown fields and malformed configuration fail startup explicitly. Network availability is never checked at startup; fetching happens when browsing and uses the existing bounded public-network distribution client.

Configured sources have `configured:<id>` identities and `managed: true`. They remain in memory and are never inserted into `registry.sqlite`. User sources retain UUID identities, revision-CAS writes and their existing 16-source limit. A configured URL takes presentation precedence over an identical user URL without deleting that record; removing configuration reveals the retained user source. Configured sources cannot be deleted through user-source APIs. Changing runtime configuration does not increment the installation registry revision. Installed snapshots, credentials and data remain independent.

This is an operator integration point, not a user-facing official directory. Desktop and Web use the same authenticated runtime endpoints. Configuration belongs to the runtime process, including a remote runtime when connected remotely; setting it only on a renderer does nothing. Existing installations require configuration plus restart, or a future normal release that supplies configuration. They do not enroll through an undisclosed remote switch.

## Directory document

The existing `flower.agent_plugin_catalog.v1` document gains an optional `display` object on each entry:

```json
{
  "schema_version": "flower.agent_plugin_catalog.v1",
  "id": "team",
  "plugins": [
    {
      "id": "review",
      "display": {
        "name": "Code review",
        "description": "Review project changes.",
        "author": "Example"
      },
      "source": {
        "type": "github",
        "repository": "example/tools",
        "ref": "stable",
        "path": "plugins/review"
      }
    }
  ]
}
```

Directory and stable entry IDs follow plugin-name syntax; entry IDs are unique within a directory and limited to 128 characters. Documents have at most 128 entries and 1 MiB; exceeding either fails without truncation. Empty `plugins: []` is valid. Missing/null plugin arrays, unsupported schema versions, trailing JSON and unknown top-level, entry or source fields fail validation. Only `display` permits additive unknown fields, discarded before returning the document. Known display fields are single-line text: name/author up to 128 Unicode characters, description up to 512. They are rendered as text, never HTML, badges, credentials or executable configuration. Incompatible source or document changes require a new schema version.

Catalogs recommend public GitHub sources only. The existing normalizer validates repository, ref, commit and package path, supplying `.` when path is omitted. Different paths in one repository remain independent installation identities. Directory entry identity is not installation identity: changing a catalog ID or removing its source never mutates an installed package.

## Browse and install boundary

Browsing retrieves bounded directory JSON only. It never downloads archives, prepares packages, launches processes or changes enablement. Selecting Install sends the entry source through the same preparation workflow as manual GitHub installation. That workflow resolves the revision, snapshots the selected package and validates its actual manifest and components. Preview uses actual package metadata even when directory claims differ. Commit binds the reviewed digest and explicit component selection. A topic, directory listing or valid manifest is not a review endorsement.

Failed fetches remain errors with Retry, distinct from a successful empty list. Discovery failure, unconfigured discovery and source removal do not affect installed management or execution. UI details belong to [Flower extensions](../ui/flower-extensions.md); distribution, snapshots and permissions belong to [Agent Plugins](flower-agent-plugins.md).

# Boundaries

No hosting, content index, scheduled crawler, publication portal, rankings, authentication onboarding or native `.redevplugin` market changes are included. Redeven owns this distribution/presentation boundary and continues consuming published upstream components. Plugin authors need no Flower-specific folder. A future GitHub topic convention is not an implemented discovery promise.

# Evidence

- `internal/ai/agentplugins/catalog_test.go` covers schema boundaries, persistence separation, unavailable sources and multiple package paths through real preparation/commit.
- `internal/ai/agent_plugin_catalog_test.go` covers runtime configuration and read authority.
- `internal/envapp/ui_src/src/ui/flower/FlowerExtensions.browser.test.tsx` covers default absence, configured browsing, failure/retry, source management, actual preview metadata, responsive layouts and retained state.
- `desktop/src/main/runtimeFlowerRoutes.test.ts` covers configured-source IDs through the shared read-only route.
