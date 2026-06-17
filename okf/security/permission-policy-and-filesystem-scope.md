---
type: Security Contract
title: Permission policy and filesystem scope
description: Runtime permissions are clamped by local policy and file features are scoped by directory root policy.
tags: [security, permissions, filesystem, runtime]
timestamp: 2026-06-17T00:00:00Z
---

Redeven treats endpoint runtime policy as authoritative. Control-plane grants can authorize a session, but the runtime clamps those grants with a local permission policy and file-facing features use explicit filesystem root policy.

# Mechanism

The local permission policy is a three-bit read/write/execute cap. It starts from `local_max`, optionally intersects by user and by floe app, and supports presets for read-only, execute+read, and full read/write/execute. Session startup intersects the control-plane grant with the local cap before the runtime stores effective permission flags. Filesystem scope validates explicit root ids, labels, paths, kinds, default root references, and the invariant that write implies read.

# Boundaries

Browser state, provider metadata, and UI affordances cannot widen runtime permissions. Future file, Git, Flower, Code App, and terminal changes should update OKF only after the runtime code or typed policy changes.

# Citations

[1] redeven:internal/config/permission_policy.go:11 - PermissionPolicy is the local endpoint cap for session metadata.
[2] redeven:internal/config/permission_policy.go:25 - PermissionSet is the read/write/execute model.
[3] redeven:internal/config/permission_policy.go:32 - Permission sets intersect by logical AND.
[4] redeven:internal/config/permission_policy.go:68 - ResolveCap starts from local max and further intersects user/app caps.
[5] redeven:internal/config/permission_policy.go:97 - Permission policy presets map CLI names to concrete caps.
[6] redeven:internal/agent/agent.go:485 - Runtime session handling intersects granted permissions with the local cap.
[7] redeven:internal/agent/agent.go:508 - Code App sessions require valid codespace identity and full read/write/execute access.
[8] redeven:internal/agent/agent.go:531 - Port Forward sessions require valid forward identity and execute access.
[9] redeven:internal/config/filesystem_scope.go:11 - FilesystemScope stores versioned root policy.
[10] redeven:internal/config/filesystem_scope.go:71 - Filesystem root validation rejects write access without read access.
