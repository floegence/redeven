---
type: Runtime Contract
title: Flower Agent Plugins
tags: [ai, flower, plugins, skills, mcp, permissions]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Flower loads Agent Plugins 1.0.0 as environment-scoped Skills and MCP extensions. This domain is separate from native `.redevplugin` packages, their SDK and marketplace. A manifest identifies a package; it does not register a marketplace listing or grant execution permission.

# Contract

## Ownership and supported format
Redeven owns distribution/admission/state/credentials/UI; published Floret owns invocation, approval, effects, history/recovery; official MCP Go SDK owns wire/sessions. No local dependency copy or second lifecycle.

Root plugin.json declares https://agent-plugins.org/schemas/1.0.0/plugin.schema.json; validate 1.0.0 locally, diagnosing unknown top-level fields and ignoring foreign namespaces. Skills are immediate skills/<name>/SKILL.md children. mcp.json declares the matching canonical MCP schema. Isolate invalid entries; malformed MCP disables that component type. Support stdio/Streamable HTTP; diagnose/skip legacy SSE. Do not interpret hooks, commands, postinstall or private formats.

stdio accepts executable tokens or ./ package paths, not shell expressions. Expand PLUGIN_ROOT (managed snapshot) and PLUGIN_DATA (persistent installation data) once in args/env/cwd only; cwd stays contained. Do not inherit parent secrets. HTTP headers are literal; generated protocol/auth fields win and redirects are denied.

## Discovery and distribution
Administrators select readable local directories, public GitHub repository/ref/path, or explicit HTTPS catalogs. Resolve refs to immutable commit receipts before bounded download; local directories become snapshots. Flower catalogs use schema_version flower.agent_plugin_catalog.v1, id, and plugins containing id plus {type: github, repository, ref, path} sources; this is outside the Agent Plugins standard.

Catalogs only recommend GitHub: no local installation, enabling, credentials or execution. Ship no default market/address/automatic search. [Catalog integration](flower-plugin-catalogs.md) owns opt-in sources/metadata. Admit explicit ASCII HTTPS/valid ports; reject private resolved targets, unsafe redirects, archive links/duplicates and Windows drive/stream paths. Before extraction count files/directories, allow at most 32 separators and use pinned os.Root writes. Materialize contained local symlinks; reject escapes. Limits: 4,096 entries, 16 MiB/file, 128 MiB/package/archive, 1 MiB/manifest/catalog.

## Review, persistence and recovery
Preparation owns at most four workers, two minutes each, without executing commands. Review source/components/entry points/changes before commit. New installations default disabled; new update components require selection. MCP configuration changes clear corresponding credentials; every update clears discovery.

Under <stateDir>/ai/agent-plugins/: registry.sqlite kind flower_agent_plugins/schema 1 has readonly preflight and atomic revision-CAS; packages/<sha256> stores snapshots, staging/<operation UUID> preparation, data/<installation UUID> retained data. Digests bind paths/bits/bytes. Unknown/future/drifted databases fail unchanged. One registry owns installation/component/discovery state.

Namespace/endpoint/user scope operations; request identity plus reviewed digest bind commit, and changed-selection replay fails. Ready operations expire at 30 minutes but survive disconnect/resume. Restart fails interrupted preparation. Shutdown cancels/drains workers; cleanup removes only unreferenced packages/stages, never retained data. Conversation snapshots/restores omit extension configuration/data/credentials and never construct another manager.

SecretsStore schema 4 stores immutable write-only references; no values in listings/operations/audit. Replace/clear invalidates discovery; empty objects clear and omission preserves. Uninstall retains data by default; explicit permanent deletion validates UUID/pinned root, rejecting escaping replacements. Snapshot stat/read/link inspection also uses rooted handles.

GitHub automatic checks default enabled as an explicit preference, run at most every six hours, and record availability only. Applying updates always repeats preparation/review; checks never download/apply/enable/execute.

## Projection and authorization
Project package Skills/MCP into existing managers without standalone copies. Skills bind plugin name/installation UUID/name; MCP binds installation/digest/component/revision/credential/schema. Reject namespaced standalone writes. Readers inspect; authenticated administrators manage; stdio checks additionally need write+execute.

Each skill read/MCP call resolves current authority and leases the resource. Digest mismatch fails closed. Update/uninstall cannot retire leased installations; disable prevents new dispatch immediately. Recheck MCP configuration after connecting and before dispatch. Floret retains in-flight/unknown-outcome semantics without replay. Explicit connection checks discover tools without bypassing conversation permissions.

# Boundaries

Managed snapshots and containment checks are not an OS sandbox. Enabled local commands run with the runtime user's privileges and may access resources allowed by that process. Native plugin markets and signed `.redevplugin` runtime admission are unchanged. Private GitHub authentication, OAuth onboarding, legacy SSE and external marketplace publication are outside this implementation.

# Evidence

- `internal/ai/agentplugins/` owns package/source admission, registry and update checks.
- `internal/ai/agent_plugin_integration_test.go` covers real HTTP/stdio SDK sessions, secret injection, restart discovery, revocation and package tampering.
- `internal/codeapp/appserver/server_ai_agent_plugins_test.go` covers authenticated management and operation ownership.
- [Flower extensions UI](../ui/flower-extensions.md) owns interaction and carrier presentation.
- Format reference: `https://agent-plugins.org/specification`, canonical 1.0.0 schemas, reviewed October 28, 2026.
