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

The reusable runtime filesystem service owns path context and directory listing over the configured filesystem scope. `fs.getPathContext()` is the authority for the complete root set, default root, and root permissions. Home paths supplied by Git, Terminal, Flower, Workbench, or floating surfaces are display hints for rendering `~`; they cannot replace roots, change the default root, widen scope, or create authorization. A directed file-browser request refreshes path context and validates the requested directory with the existing `fs.list` operation, so session read permission, root read permission, canonical and symlink boundaries, and the host filesystem read all remain part of one authoritative decision. Code App Local API exposes read-only `GET /_redeven_proxy/api/fs/path_context` and `POST /_redeven_proxy/api/fs/list` for browser-facing directory pickers; both routes require read permission before calling the filesystem service, and list errors preserve scope, root or session read denial, host permission denial, missing paths, non-directory paths, and invalid paths without bypassing `filesystemscope.Registry`.

Directed navigation is transactional and user-visible. While validation is pending, Files retains the last committed directory. Only the newest request may atomically commit its path, root selection, title, contents, and persistence; canceled or superseded results have no UI or notification effect. Deterministic path failures may use an authorized readable ancestor or default root only when the browser has no committed directory, and that automatic fallback must be reported in a persistent in-browser recovery surface without replacing the persisted last path. Transient connection, timeout, and service failures never masquerade as successful Home navigation. Failures identify the requested and current paths with localized recovery actions such as retry, explicit Home or parent navigation, path copy, and filesystem-access settings when the session may administer them.

The Files browser may present a session-only directory snapshot immediately after that directory was validated in the same session, then revalidate it in the background. A snapshot is a rendering optimization, not an authorization source: every remote read still passes through the current scope and permission checks. Each directory cache entry carries a mutation revision; a response started before a local create, delete, rename, move, or copy cannot overwrite the newer local snapshot. A transient background refresh retains the visible snapshot and marks it stale for retry, while deterministic failures invalidate the target prefix and recover through a freshly authorized ancestor. The browser owns one active read and one queued latest intent, and aborting client-side waiting only suppresses stale result consumption; it does not claim to stop work already sent to the runtime.

`fs.extract` is the single archive-extraction boundary. It requires effective session read and write permissions, resolves the source and destination through `filesystemscope.Registry`, and runs under the filesystem mutation coordinator. The browser uses the released `floe-webapp` filename classifier only to expose ZIP, 7z, RAR, TAR, compressed TAR, and single-file compression affordances; the runtime identifies the actual format from file content before extraction. Multipart archives fail explicitly. Passwords remain request-scoped and fields named as passwords are redacted from debug-console snapshots.

Flower permission snapshots use one explicit v2 JSON/hash view containing only current permission semantics, visible and Floret tool names, prompt capabilities, and tool policies. Tool scheduling metadata is not part of permission policy. Serialization, persistence, recovery, and dispatch require an explicit v2 version plus complete identity and hashes. Unversioned, v1, unknown-version, unknown-field, multi-value, empty, or inconsistent snapshots fail closed and are never converted. Current permission comes only from `ai_thread_settings.permission_type`; each provider step and final handler dispatch rebuilds and persists the exact current snapshot, and any snapshot id, epoch, decision, authority-thread, or fork-mode drift rejects execution. Child spawn snapshots are lineage audit only and never become current authority. Model capability cache version 4 similarly excludes local scheduling behavior, because provider generation support is not an executor authorization decision.

Approval authorization is independent from tool execution concurrency. Floret owns the current pending interaction and stable interaction identity. Redeven verifies the session, endpoint, thread, interaction, and current product permission, then resolves that exact interaction through the typed thread runtime. The effect adapter receives one exact, one-shot authorization for the requested invocation; a stale, duplicate, canceled, or already-resolved interaction cannot authorize another effect. Redeven persists only product authorization audit and does not maintain an approval queue, receipt, generation, revision, or recovery lifecycle.

# Boundaries

Browser state, display-only Home hints, provider metadata, and UI affordances cannot widen runtime permissions. A UI that still exposes a terminal under execute-only access is a product bug, but the Terminal RPC independently enforces the same write-and-execute process boundary. Local API filesystem list endpoints are not a write surface and do not grant access outside configured roots. Operating-system readability alone does not authorize a path: access exists only where the current session, configured filesystem root, canonical path boundary, and actual host read all permit it. Future file, Git, Flower, Code App, and terminal changes should update OKF only after the runtime code or typed policy changes.

Archive output is built beside the destination in a private staging file or directory. Entry paths reject absolute paths, volume prefixes, traversal, NUL bytes, duplicates, conflicting parents, and special filesystem nodes. Regular payloads finish before links are created; every symbolic-link and hard-link graph must resolve to an existing safe target inside staging, including forward references, and cycles or escaping targets fail closed. Completed output is published with a platform no-replace rename and a deterministic unused-name suffix, so existing files are never overwritten. Failure or cancellation removes staging before the RPC settles; cleanup failure is surfaced explicitly rather than hidden. Skill import and release-cache writes retain their own equivalent boundary discipline: skill copies reject symbolic links and resolve the nearest existing ancestor, while downloaded release evidence uses exclusive private temporary files and atomic publication. Git fallback rejects option-like paths and invalid refs and places `--` before user-derived operands. Password gates use a computationally expensive password hash, and failed-attempt cooldown timestamps are recorded after verification so hashing latency cannot silently bypass throttling. Structured logs replace control characters and bound untrusted values to prevent log injection.

Permission effects, resource kinds, tool names, arguments, file paths, shell text, approval requirements, and UI queue position must not be used to infer tool-call dependencies or force execution order. Models express dependency by waiting for the prerequisite result and emitting the dependent call in a later response. Provider wire configuration may enable multi-call generation, but it cannot grant permission, bypass approval, or alter runtime scheduling.

# Evidence

- `redeven:internal/config/permission_policy.go:11` - PermissionPolicy is the local endpoint cap for session metadata.
- `redeven:internal/agent/agent.go:485` - Runtime session handling intersects granted permissions with the local cap.
- `redeven:internal/config/filesystem_scope.go:11` - FilesystemScope stores versioned root policy.
- `redeven:internal/fs/service.go:101` - The filesystem service preserves stable directory-list error categories at the RPC boundary.
- `redeven:internal/fs/service.go:493` - The filesystem service exposes path context for consumers without duplicating scope logic.
- `redeven:internal/envapp/ui_src/src/ui/widgets/RemoteFileBrowser.tsx:1164` - Files refreshes authoritative path context independently from display-only Home hints.
- `redeven:internal/envapp/ui_src/src/ui/widgets/RemoteFileBrowser.tsx:3769` - Directory navigation owns one active request and one queued latest intent, commits only the latest validated result, and controls fallback persistence explicitly.
- `redeven:internal/envapp/ui_src/src/ui/widgets/RemoteFileBrowserNavigation.ts` - Session directory snapshots carry mutation revisions and reject stale remote replacement.
- `redeven:internal/envapp/ui_src/src/ui/widgets/ArchiveExtractionDialog.tsx` - The archive panel owns request-scoped password retry, destination selection, and cancellation.
- `redeven:internal/fs/archive.go` - Filesystem scope, content identification, staging, safe entry and link validation, and no-replace publication share one extraction path.
- `redeven:internal/fs/archive_test.go` - Extraction tests cover permissions, coordination, passwords, cancellation cleanup, collisions, corrupt and multipart inputs, and unsafe paths and links.
- `redeven:internal/codeapp/appserver/server.go:1969` - The Local API path context route requires read permission.
- `redeven:internal/session/types.go:29` - General process launch is derived from write and execute permission together.
- `redeven:internal/terminal/manager.go:169` - Every terminal RPC entry point uses the shared process-launch permission boundary.
- `redeven:internal/ai/permission_snapshot.go:78` - Permission snapshot serialization and decoding accept only explicit strict v2.
- `redeven:internal/ai/permission_type.go:427` - Permission snapshot hashing rejects missing or unsupported versions.
- `redeven:internal/ai/run.go:2957` - Final handler authorization refreshes current settings and rejects snapshot or decision drift.
- `redeven:internal/ai/approval_command.go` - Approval commands validate product authority and resolve one typed Floret interaction.
- `redeven:internal/ai/approval_conflict.go:9` - Approval state races have a dedicated sentinel and stable error code.
- `redeven:internal/codeapp/codeserver/artifact.go:342` - Managed runtime archive symlinks are resolved inside the staging root before creation.
- `redeven:internal/ai/skill_manager_remote.go:1339` - Skill copies reject symbolic links and resolve existing ancestors before filesystem operations.
- `redeven:internal/ai/skill_manager_remote_test.go:307` - Skill import tests reject Git option injection through refs and repository paths.
- `redeven:desktop/src/main/sshReleaseAssets.ts:271` - Verified release downloads use exclusive private temporary files and atomic publication.
- `redeven:internal/accessgate/accessgate.go:117` - Local access passwords use bcrypt and throttling records the post-verification failure time.
- `redeven:internal/logsafe/logsafe.go:10` - Structured log values are single-line and bounded.
