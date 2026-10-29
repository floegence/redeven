---
type: Runtime Contract
title: Flower Agent Plugins
tags: [ai, flower, plugins, skills, mcp, permissions]
lifecycle: contract
reviewed_at: "2026-10-29"
---
# Summary

Flower loads Agent Plugins 1.0.0 as environment-scoped Skills and MCP extensions. This domain is separate from native `.redevplugin` packages, their SDK and marketplace. A manifest identifies a package; it does not register a marketplace listing or grant execution permission.

# Contract

## Ownership and supported format

Redeven owns distribution, admission, installation state, credentials and presentation. Published Floret owns invocation, approval, effects, history, cancellation and recovery; the official MCP Go SDK owns wire/session mechanics. Existing published APIs suffice, so this integration needs no upstream source copy, local dependency override or parallel execution lifecycle.

`plugin.json` at the package root must declare `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`. Validation follows the published 1.0.0 specification, including diagnostic-only unknown top-level fields and ignored foreign extension namespaces. No schema is fetched while loading. Skills are immediate `skills/<name>/SKILL.md` children. `mcp.json` must declare the matching canonical MCP schema. Invalid skill/server entries are isolated; malformed MCP documents disable that component type. Available transports are stdio and Streamable HTTP. Legacy SSE is diagnosed and skipped. Hooks, commands, postinstall scripts and vendor-private plugin formats are not interpreted.

stdio commands are executable tokens or `./` package paths, never implicit shell expressions. `PLUGIN_ROOT` is the resolved managed snapshot; `PLUGIN_DATA` is writable per-installation state preserved across updates. Those placeholders expand once in args, environment values and cwd only. Package/data cwd cannot escape its root. Parent secrets are not inherited. HTTP headers are literal; client-generated protocol and authorization fields take precedence, and redirects are denied.

## Discovery and distribution

An administrator can select a directory in the runtime's readable filesystem scope, a public GitHub repository/ref/package path, or add an explicit public HTTPS catalog. GitHub refs resolve to commit receipts before bounded archive download. Local packages become snapshots; they are not live mounts.

Flower's distribution format is deliberately outside the Agent Plugins standard:

```json
{
  "schema_version": "flower.agent_plugin_catalog.v1",
  "id": "example",
  "plugins": [
    {"id": "tools", "source": {"type": "github", "repository": "example/tools", "ref": "v1", "path": "."}}
  ]
}
```

Catalogs recommend GitHub sources only. They cannot install local paths, enable components, supply credentials or execute commands. No default marketplace, official directory address or automatic GitHub search is shipped. [Catalog integration](flower-plugin-catalogs.md) defines opt-in runtime sources and display metadata. Distribution rejects private resolved network addresses, unsafe redirects, archive links/duplicate paths and Windows drive/stream paths. Archive admission counts files and directories before extraction, limits paths to 32 separators, and writes through a pinned `os.Root` handle. Local contained symlinks are materialized; escapes fail preparation. These restrictions precede component loading. Limits: 4,096 entries, 16 MiB per file, 128 MiB per package/archive, 1 MiB per manifest/catalog configuration.

## Review, persistence and recovery

Preparation is an owned asynchronous operation, bounded to four concurrent workers and two minutes per preparation. It never runs package commands. The administrator reviews source, components, execution entry points and changed/removed components before commit. New installations default disabled. New update components also require selection. Updated MCP connection configuration clears the corresponding credential binding; all updates clear tool discovery.

State lives in `<stateDir>/ai/agent-plugins/`: `registry.sqlite` has database kind `flower_agent_plugins`, schema 1, strict readonly preflight and atomic revision-CAS writes. `packages/<sha256>` contains managed snapshots, `staging/<operation UUID>` holds preparation, and `data/<installation UUID>` holds persistent plugin data. Digests bind paths, executable bits and contents. Unknown/future/drifted databases fail without reset. Installation, component state and discovered tool metadata have one registry authority.

Operations are private to namespace, endpoint and user identity. Request identity and reviewed digest bind commit; replay with different selection fails. Ready operations expire after 30 minutes, survive disconnection and can be resumed. Interrupted preparation becomes failed after restart. Shutdown cancels and drains owned workers. Cleanup removes only unreferenced package/staging directories; retained data is never garbage-collected.

Conversation snapshots do not include environment extension configuration, package data or credentials. Restore staging does not create a plugin manager; the live registry, snapshots and data remain unchanged, matching standalone MCP/Skills configuration ownership.

Credentials use immutable references in the existing locked SecretsStore, schema 4. Values are write-only and never included in plugin listing, operation views or audit records. Replacing/clearing credentials invalidates discovery. Empty objects clear; omission preserves. Uninstall defaults to retaining data; permanent deletion is an explicit option.

GitHub installations offer an explicit automatic-check preference, initially enabled. A service worker checks eligible refs no more often than every six hours; it only records update availability. It never downloads, applies, enables or runs updates. Applying an update always returns through preparation and review.

## Projection and authorization

Package Skills and MCP entries project into the existing managers; they are not copied into standalone configuration. Skill selectors include plugin name, installation UUID and skill name. MCP identities include installation, digest, component, revision, credential reference and tool schema. Namespaced standalone writes are rejected. Readers inspect; authenticated administrators manage. Checking stdio also requires existing write+execute process permission.

Each skill read or MCP call resolves current authority and obtains a resource lease. Digest mismatches fail closed. Update/uninstall cannot retire a leased installation; disabling immediately prevents future dispatch. MCP configuration is checked again after connection and before dispatch. In-flight execution keeps Floret's existing outcome semantics; unknown outcomes are never replayed. Connection checks discover tools explicitly and do not bypass conversation permissions.

# Boundaries

Managed snapshots and containment checks are not an OS sandbox. Enabled local commands run with the runtime user's privileges and may access resources allowed by that process. Native plugin markets and signed `.redevplugin` runtime admission are unchanged. Private GitHub authentication, OAuth onboarding, legacy SSE and external marketplace publication are outside this implementation.

# Evidence

- `internal/ai/agentplugins/` owns package/source admission, registry and update checks.
- `internal/ai/agent_plugin_integration_test.go` covers real HTTP/stdio SDK sessions, secret injection, restart discovery, revocation and package tampering.
- `internal/codeapp/appserver/server_ai_agent_plugins_test.go` covers authenticated management and operation ownership.
- [Flower extensions UI](../ui/flower-extensions.md) owns interaction and carrier presentation.
- Format reference: `https://agent-plugins.org/specification`, canonical 1.0.0 schemas, reviewed October 28, 2026.
