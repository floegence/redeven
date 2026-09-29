---
type: Runtime Contract
title: Flower MCP runtime
description: Configure external MCP servers and execute their tools through Flower's existing Floret authorization boundary.
tags: [ai, flower, mcp, permissions]
timestamp: 2026-09-29T00:00:00Z
---
# Summary

Redeven owns administrator-managed MCP configuration and a thin product adapter
over the released official Model Context Protocol Go SDK. The SDK owns stdio
and Streamable HTTP protocol sessions. Floret owns invocation identity,
approval, one-shot effect authorization, history, and recovery through the
[typed thread runtime](floret-thread-runtime.md). MCP must not introduce another
execution queue, lifecycle projection, or retry authority. A lost call outcome
is terminal and cannot be replayed. Invalid persisted configuration fails closed
without changing the original bytes.

# Configuration and protocol

Configuration lives at `<stateDir>/ai/mcp.json`, with schema version 1, one
monotonic configuration revision, and server revisions for optimistic edits.
Revisions are not reused when an ID is deleted and recreated. Writes validate
first, use a private 0600 temporary file, sync it, and atomically rename it.
Persistence failure leaves the in-memory catalog unchanged. Unsupported schema,
unknown fields, invalid tools, and oversized state are rejected at startup.

The authenticated `/api/ai/mcp` route under `/_redeven_proxy` supports GET for
readers and PUT/DELETE for administrators. `/api/ai/mcp/check` accepts an explicit
administrator POST. Request decoding is strict and bounded. Mutation requires
the current server revision; stale forms cannot overwrite concurrent changes.
Connection or discovery failure leaves the previous configuration intact.
Disabling does not connect and remains possible when a server is unavailable.

Supported transports are Streamable HTTP and a directly invoked executable
using stdio. Remote endpoints require HTTPS; HTTP is limited to loopback.
Endpoint user info, query credentials, fragments, and redirects are rejected.
Headers cannot override protocol framing. Local executables receive selected
host environment basics plus configured variables, not all parent credentials.
No shell command interpolation or automatic package installation is added.
Connecting to an enabled server may start its configured executable.

Header/environment values are write-only through management APIs. Catalogs
expose key names only; omitted maps preserve values and explicit empty maps
clear them. Transport changes do not carry credentials between transports.
Lists and ordinary startup never connect to servers. Explicit discovery has a
15-second deadline; tool calls have a one-minute bound. Each operation owns
and closes one SDK session. Catalog limits are 32 servers, 128 tools per server,
32 KiB per schema, and 4 MiB total persisted configuration.

# Execution and dependencies

Enabled, previously discovered tools join the dynamic tool surface before the
existing permission filter. Their identity binds the exact server configuration
and tool schema, so a changed or disabled configuration cannot execute through
an old invocation name. Connection checks with unchanged definitions retain the
same identity. Third-party input schemas, including fields named `target_id`,
remain intact and have no Redeven target-routing authority.

The configuration revision is checked again after connection establishment and
before tool dispatch. Disabling or editing a server prevents a call still waiting
to connect; it does not cancel or replay an already dispatched operation.

MCP tools are conservatively mutating and open-world regardless of server
annotation claims. HTTP declares network/write effects; stdio declares
shell/write effects. They are absent in read-only mode. Approval-required mode
uses Floret's normal approval; full access follows the existing explicit
permission setting. Execution also requires the authenticated read/write/execute
ceiling and the exact Floret effect proof. An MCP handler cannot run directly
without that proof.

SDK call transport failure becomes an unknown-effect dispatch error. Floret
seals it as `effect_outcome_unknown` and rejects Retry; neither the adapter nor
the SDK retries the call. An explicit MCP tool error retains bounded tool output
as error context. Server tool errors and known connection failures remain
distinct from an unknown execution outcome.

Skill dependency declarations never install or enable a server. A dependency's
name must match the administrator's server ID; any declared transport, URL, or
command must also match. Enabled, checked configuration satisfies the catalog
indicator; it does not promise current network reachability or bypass approval.

# Evidence

- `internal/ai/mcp_manager.go` owns configuration, SDK adaptation, and discovery.
- `internal/codeapp/appserver/server_ai_mcp.go` owns bounded management DTOs.
- `internal/ai/run_tool_surface.go`, `internal/ai/floret_tools.go`, and
  `internal/ai/run.go` join MCP to existing authorization and effect execution.
- `internal/ai/mcp_manager_test.go` verifies HTTP/stdio, private credentials,
  persistence, stale edits, schema rejection, and dependencies.
- `internal/ai/mcp_runtime_integration_test.go` executes real protocol sessions
  through the typed thread runtime and verifies the terminal no-retry boundary.
- `internal/codeapp/appserver/server_ai_mcp_test.go` verifies route authorization,
  origin checks, strict request decoding, and credential redaction.
