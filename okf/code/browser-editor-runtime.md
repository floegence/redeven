---
type: Runtime Contract
title: Browser Editor runtime
description: Code App serves Browser Editor codespaces through the local app server and managed code workspace engine APIs.
tags: [code-app, browser-editor, local-ui, desktop]
timestamp: 2026-06-17T00:00:00Z
---

Browser Editor support is owned by the Code App app server. Codespaces are opened through Local UI `/cs/<id>/` routes, while Desktop and Env App can prepare or update managed Browser Editor runtime versions through code workspace engine APIs.

# Mechanism

The Code App app server backend owns codespace lifecycle, port resolution, managed runtime status, import sessions, chunk upload, completion, version selection, version removal, and operation cancellation. Local UI routes `/cs/*` to the app server. Runtime-control mirrors the code workspace engine import flow for Desktop-managed setup. The code-server runner starts the editor bound to loopback with no editor auth, an absolute proxy base path under `/cs/<code_space_id>`, disabled telemetry/update checks, scoped data directories, and a short stable session socket path.

# Boundaries

Opening or managing Browser Editor is not just a static file route. Version setup and removal require full read/write/execute runtime permissions, while status reads require read permission.

# Citations

[1] redeven:internal/codeapp/appserver/server.go:80 - App server backend owns codespace start, stop, delete, and port resolution.
[2] redeven:internal/codeapp/appserver/server.go:84 - App server backend owns managed code runtime status and import operations.
[3] redeven:internal/localui/localui.go:132 - Local UI mounts `/cs/` for codespace routes.
[4] redeven:internal/localui/runtime_control.go:139 - Runtime-control exposes code workspace engine status and import routes.
[5] redeven:internal/codeapp/appserver/server.go:2302 - Code runtime status requires read permission.
[6] redeven:internal/codeapp/appserver/server.go:2314 - Code runtime import sessions require full permission.
[7] redeven:internal/codeapp/appserver/server.go:2341 - Runtime import chunks are uploaded by upload id and chunk index.
[8] redeven:internal/codeapp/appserver/server.go:2389 - Runtime version selection requires full permission.
[9] redeven:internal/codeapp/codeserver/runner.go:274 - code-server uses `/cs/<code_space_id>` as the absolute proxy base path.
[10] redeven:internal/codeapp/codeserver/runner.go:276 - code-server binds to loopback with editor auth disabled.
