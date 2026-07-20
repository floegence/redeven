---
type: Security Contract
title: Permission policy and filesystem scope
description: Runtime permissions are clamped by local policy and file features are scoped by directory root policy.
tags: [security, permissions, filesystem, runtime]
timestamp: 2026-07-14T00:00:00Z
---
# Summary

Redeven treats endpoint runtime policy as authoritative. Control-plane grants can authorize a session, but the runtime clamps those grants with a local permission policy and file-facing features use explicit filesystem root policy.

Runtime permissions are clamped by local policy and file features are scoped by directory root policy.

# Contract

## Mechanism

The local permission policy is a three-bit read/write/execute cap. It starts from `local_max`, optionally intersects by user and by floe app, and supports presets for read-only, execute+read, and full read/write/execute. Session startup intersects the control-plane grant with the local cap before the runtime stores effective permission flags. The execute+read preset permits explicitly modeled execute-like operations, but general-purpose shell access and arbitrary process launch require both effective write and execute permission. Filesystem scope validates explicit root ids, labels, paths, kinds, default root references, and the invariant that write implies read.

The reusable runtime filesystem service owns path context and directory listing over the configured filesystem scope. Code App Local API exposes read-only `GET /_redeven_proxy/api/fs/path_context` and `POST /_redeven_proxy/api/fs/list` for browser-facing directory pickers; both routes require read permission before calling the filesystem service, and list errors preserve scope, read-denied, missing, and not-directory distinctions without bypassing `filesystemscope.Registry`.

Flower permission snapshots use one explicit v2 JSON/hash view containing only current permission semantics, visible and Floret tool names, prompt capabilities, and tool policies. Tool scheduling metadata is not part of permission policy. Serialization, persistence, recovery, and dispatch require an explicit v2 version plus complete identity and hashes. Unversioned, v1, unknown-version, unknown-field, multi-value, empty, or inconsistent snapshots fail closed and are never converted. Current permission comes only from `ai_thread_settings.permission_type`; each provider step and final handler dispatch rebuilds and persists the exact current snapshot, and any snapshot id, epoch, decision, authority-thread, or fork-mode drift rejects execution. Child spawn snapshots are lineage audit only and never become current authority. Model capability cache version 4 similarly excludes local scheduling behavior, because provider generation support is not an executor authorization decision.

Approval authorization is independent from tool execution concurrency. Multiple calls may wait for approval concurrently, but the thread queue exposes only one current action. Every submit validates session user, endpoint/thread/run ownership, action id, queue generation and revision, queue-head identity, expected live sequence, action revision/version, surface epoch, delegated reference when present, and the current Floret pending approval before releasing a waiter. Stale, duplicate, resolved, timed-out, unavailable, canceled, or non-head submissions return HTTP 409 with `AI_APPROVAL_CONFLICT` and cannot reach a tool handler. A client may retry only after canonical resync proves that the same action remains current and actionable; approval intent must never transfer to another promoted action. Queue time does not consume the decision timeout. Runtime stop closes unresolved in-memory waiters, while reconnect and restart rebuild the approval surface from Floret. Redeven persists only authorization audit and has no delegated approval lifecycle, idempotency, or outbox tables.

# Boundaries

Browser state, provider metadata, and UI affordances cannot widen runtime permissions. A UI that still exposes a terminal under execute-only access is a product bug, but the Terminal RPC independently enforces the same write-and-execute process boundary. Local API filesystem list endpoints are not a write surface and do not grant access outside configured roots. Future file, Git, Flower, Code App, and terminal changes should update OKF only after the runtime code or typed policy changes.

Permission effects, resource kinds, tool names, arguments, file paths, shell text, approval requirements, and UI queue position must not be used to infer tool-call dependencies or force execution order. Models express dependency by waiting for the prerequisite result and emitting the dependent call in a later response. Provider wire configuration may enable multi-call generation, but it cannot grant permission, bypass approval, or alter runtime scheduling.

# Evidence

- `redeven:internal/config/permission_policy.go:11` - PermissionPolicy is the local endpoint cap for session metadata.
- `redeven:internal/agent/agent.go:485` - Runtime session handling intersects granted permissions with the local cap.
- `redeven:internal/config/filesystem_scope.go:11` - FilesystemScope stores versioned root policy.
- `redeven:internal/fs/service.go:260` - The filesystem service exposes path context for consumers without duplicating scope logic.
- `redeven:internal/codeapp/appserver/server.go:1969` - The Local API path context route requires read permission.
- `redeven:internal/session/types.go:29` - General process launch is derived from write and execute permission together.
- `redeven:internal/terminal/manager.go:169` - Every terminal RPC entry point uses the shared process-launch permission boundary.
- `redeven:internal/ai/permission_snapshot.go:78` - Permission snapshot serialization and decoding accept only explicit strict v2.
- `redeven:internal/ai/permission_type.go:427` - Permission snapshot hashing rejects missing or unsupported versions.
- `redeven:internal/ai/run.go:2957` - Final handler authorization refreshes current settings and rejects snapshot or decision drift.
- `redeven:internal/ai/flower_live_projection.go:726` - Approval submission validates queue and action CAS state before dispatching a decision.
- `redeven:internal/ai/approval_conflict.go:9` - Approval state races have a dedicated sentinel and stable error code.
