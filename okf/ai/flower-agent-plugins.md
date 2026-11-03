---
type: Runtime Contract
title: Flower Agent Plugins
tags: [ai, flower, plugins, skills, mcp, permissions]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Flower loads environment-scoped Agent Plugins1.0.0 Skills/MCP, separate from native .redevplugin SDK/packages/market. Redeven owns admission/distribution/configuration and Floret invocation/history. A manifest identifies a package, never grants execution or registers a market listing.

# Contract

## Format/ownership
Redeven owns distribution/admission/state/credentials/UI; Floret dispatch/approval/effects/history/recovery; official MCP Go SDK wire/sessions. No copied dependencies or second lifecycle.

Root plugin.json uses https://agent-plugins.org/schemas/1.0.0/plugin.schema.json, validated locally; diagnose unknown top-level fields,ignore foreign namespaces. Immediate skills/<name>/SKILL.md children define Skills; mcp.json uses canonical matching schema. Isolate invalid entries; malformed MCP disables component type. stdio/Streamable HTTP supported; legacy SSE diagnosed/skipped. No hooks/commands/postinstall/private format interpretation.

stdio executable token or ./ package path,never shell expression. Expand PLUGIN_ROOT snapshot/PLUGIN_DATA persistent path once in args/env/cwd; keep cwd contained,no ambient secrets. HTTP headers literal,generated auth/protocol wins,no redirects.

## Distribution
Admins select readable local dirs,public GitHub repo/ref/path or explicit HTTPS catalogs. Freeze refs to commit receipts before bounded download; local dirs snapshot. Product catalog schema flower.agent_plugin_catalog.v1 has id/plugins{id,source{type:github,repository,ref,path}},outside Agent Plugins standard.

Catalog only recommends GitHub; no local install/enable/credentials/execution/default market/address/auto-search. [Catalogs](flower-plugin-catalogs.md) owns opt-in metadata. ASCII HTTPS/valid ports only; reject private DNS targets,unsafe redirects,archive links/duplicates,Windows drive/stream paths. Count entries before extraction,max32 separators,pinned os.Root writes. Materialize contained local symlinks,reject escapes. Limits4096 entries,16MiB/file,128MiB package/archive,1MiB manifest/catalog.

## Review/state/recovery
Prepare<=four workers/two minutes each,no commands. Review source/components/entrypoints/changes before commit. New installs disabled; new update components explicit. MCP config change clears matching credentials; every update clears discovery.

<stateDir>/ai/agent-plugins/:registry.sqlite kind flower_agent_plugins/schema1,read-only preflight/atomic revision-CAS; packages/<sha256> snapshot; staging/<operation UUID>; data/<installation UUID> retained. Digest binds paths/bits/bytes. Future/unknown/drifted stores fail untouched. One registry owns install/component/discovery.

Scope by namespace/endpoint/user; request ID+reviewed digest binds commit,changed-selection replay fails. Ready expires30min but resumes across disconnect; restart fails interrupted prep. Shutdown drains/cancels; cleanup only unreferenced packages/stages,never retained data. Conversation backup/restore omits extensions/config/data/credentials and creates no second manager.

SecretsStore schema4 stores immutable write-only refs,never listed/audited values. Replace/clear invalidates discovery; empty object clears,omission preserves. Uninstall retains data unless explicit permanent delete validates UUID/pinned root; reject escaping replacement. Snapshot stat/read/link uses rooted handles.

Explicit GitHub auto-check preference defaults enabled,<=once/6h,availability only. Apply repeats preparation/review; checks never download/apply/enable/execute.

## Projection/authority
Use existing Skills/MCP managers,not copies. Skills bind plugin name/install UUID/name; MCP install/digest/component/revision/credential/schema. Reject namespaced standalone writes. Readers inspect; authenticated admins manage; stdio additionally write+execute.

Every skill read/MCP call resolves authority and leases resource. Digest mismatch rejects; update/uninstall cannot retire leased install,disable blocks new dispatch immediately. Recheck MCP config after connect/before dispatch. Floret owns in-flight/unknown-effect semantics,no replay. Explicit checks discover tools without bypassing conversation permissions.

# Boundaries

Snapshots/containment are not OS sandbox: enabled commands run as Runtime user. Native signed packages/markets unchanged. Private GitHub auth,OAuth onboarding,legacy SSE/external marketplace publishing excluded.

# Evidence

- `internal/ai/agentplugins/`
- `internal/ai/agent_plugin_integration_test.go`
- `internal/codeapp/appserver/server_ai_agent_plugins_test.go`
- [Extensions UI](../ui/flower-extensions.md)
- `https://agent-plugins.org/specification`,canonical1.0.0 schemas reviewed October28,2026.
