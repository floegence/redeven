---
type: Runtime Contract
title: Flower MCP runtime
tags: [ai, flower, mcp, permissions]
lifecycle: contract
reviewed_at: "2026-10-29"
---
# Summary

Redeven configures MCP and adapts the released official Go SDK, which owns stdio/Streamable HTTP sessions. Floret owns invocation, approval, one-shot effects, history/recovery. Add no second execution queue/lifecycle/retry authority. Unknown call outcomes are terminal and never replayed; invalid persisted config fails without changing bytes.

# Contract

## Configuration and protocol
Standalone configuration lives at `<stateDir>/ai/mcp.json`, with schema version 2, one monotonic configuration revision, and server revisions for optimistic edits. Persistence failure leaves the in-memory catalog unchanged.

Catalog limits are 32 servers, 128 tools per server, 32 KiB per schema, and 4 MiB total persisted configuration.

Package-owned connections project from the [Agent Plugins registry](flower-agent-plugins.md). They use the same SDK/session and Floret invocation paths, with separate credentials and explicit discovery. They cannot be edited through standalone MCP writes.

## Standalone identity
Creation accepts an omitted local ID and display name. The runtime generates a cryptographically random lowercase ID with an mcp_ prefix, independently of the name or connection address; duplicate explicit IDs are conflicts, never replacements. Edits require the saved ID and revision. Missing IDs with a nonzero revision fail without creating another connection. Existing IDs and exact-ID Skill dependency matching remain unchanged.

For new unnamed connections, use the HTTP hostname or local executable basename, then prefer serverInfo.title followed by serverInfo.name from the existing successful initialize exchange. Automatically selected names are trimmed, limited to 120 UTF-8 bytes without splitting a character, and reject control characters. Explicit names win. Edits with an omitted name retain the saved name, and checks never rename a connection. Disabled creation uses connection-derived names without starting a command or contacting the server.

Typing or opening a form does not probe connections. Failed discovery/persistence does not create a saved identity; retry remains an explicit user action. The persisted schema and credential-preservation rules do not change.

## Presentation icons
Save and explicit Check read `serverInfo.icons` from the existing SDK initialize result. Connection-preserving disabled edits retain icons; changed connection settings clear stale discovery.

Rejected sources receive the generated identity described in [the shared UI contract](../ui/flower-extensions.md#entry-icons).

## Execution and dependencies
Enabled, previously discovered tools join the dynamic tool surface before the existing permission filter. Their identity binds the exact server configuration and tool schema, so a changed or disabled configuration cannot execute through an old invocation name.

Enabled, checked configuration satisfies the catalog indicator; it does not promise current network reachability or bypass approval.

# Boundaries

MCP tools are conservatively mutating and open-world regardless of server annotation claims. An MCP handler cannot run directly without that proof.

Server tool errors and known connection failures remain distinct from an unknown execution outcome.

# Evidence

- `internal/ai/mcp_manager.go` owns configuration, SDK adaptation, and discovery.

- `internal/codeapp/appserver/server_ai_mcp.go` owns bounded management DTOs.

- `internal/ai/run_tool_surface.go`, `internal/ai/floret_tools.go`, and   `internal/ai/run.go` join MCP to existing authorization and effect execution.
