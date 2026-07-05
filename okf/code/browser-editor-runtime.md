---
type: Runtime Contract
title: Browser Editor runtime
description: Code App serves Browser Editor codespaces through the local app server and managed code workspace engine APIs.
tags: [code-app, browser-editor, local-ui, desktop]
timestamp: 2026-07-05T00:00:00Z
---

Browser Editor support is owned by the Code App app server. Codespaces are opened through Local UI `/cs/<id>/` routes or through remote `cs-*` sandbox hosts, while Desktop and Env App can prepare or update managed Browser Editor runtime versions through code workspace engine APIs.

# Mechanism

The Code App app server backend owns codespace lifecycle, port resolution, managed runtime status, import sessions, chunk upload, completion, version selection, version removal, and operation cancellation. Local UI routes `/cs/*` to the app server. Runtime-control mirrors the code workspace engine import flow for Desktop-managed setup. Managed workspace engine imports validate package checksums, compressed archive size, and extracted regular file totals with a 2 GiB safety cap. The code-server runner starts the editor bound to loopback with no editor auth, an absolute proxy base path under `/cs/<code_space_id>`, disabled telemetry/update checks, scoped data directories, and a short stable session socket path.

Env App chooses an explicit codespace open target before starting the space: `desktop_window` opens a dedicated Desktop codespace window through the shell bridge, while `system_browser` keeps using the existing external browser path. When the Desktop bridge exposes codespace-window support, a running codespace presents Desktop as the primary action with Browser in the adjacent menu; a stopped codespace keeps Start primary and offers both open targets from its menu.

Desktop exposes a typed `redeven-desktop:shell-open-codespace-window` IPC request with `{ url, code_space_id }`. The trusted Env App renderer can call this bridge, but the main process still validates the sender session and checks that the URL is both allowed for the session and specifically targets the requested codespace. Accepted codespace windows use the parent session partition for remote-session continuity, reuse one window per session and codespace id, use native OS chrome with no Desktop preload, and keep `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`. Navigation inside that window is limited to the matching local `/cs/<id>/` path or a remote hostname whose first label is `cs-<id>`; other navigations and opened links are sent to the system browser.

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
[11] redeven:internal/codeapp/codeserver/artifact.go:22 - Runtime uses a 2 GiB workspace engine archive safety cap.
[12] redeven:internal/codeapp/codeserver/artifact.go:293 - Runtime counts extracted regular file sizes before writing archive entries.
[13] redeven:internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.tsx:158 - Env App resolves codespace open targets into Desktop codespace-window, Desktop external-browser, or browser popup strategies.
[14] redeven:internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.tsx:194 - Desktop codespace-window opens are committed through the shell bridge with the codespace id.
[15] redeven:internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.tsx:388 - The codespace card makes Desktop the running-card primary action when the bridge is available and keeps Browser in the menu.
[16] redeven:desktop/src/shared/desktopShellCodespaceWindowIPC.ts:1 - Desktop shell codespace-window IPC defines the channel, request, and response contract.
[17] redeven:desktop/src/preload/desktopShell.ts:70 - The trusted Desktop preload exposes `openCodespaceWindow` through the shell bridge.
[18] redeven:desktop/src/main/navigation.ts:212 - Desktop recognizes codespace URLs by local `/cs/<id>/` paths or remote `cs-<id>` host labels.
[19] redeven:desktop/src/main/navigation.ts:239 - Codespace window navigation must pass both the session allow-list and the codespace URL check.
[20] redeven:desktop/src/main/main.ts:6887 - Desktop creates or reuses one isolated codespace window per session and codespace id.
[21] redeven:desktop/src/main/main.ts:6909 - Codespace child windows use the session partition, native chrome, and no Desktop preload.
[22] redeven:desktop/src/main/main.ts:6943 - Desktop shell codespace-window requests reject stale senders or URLs outside the matching session codespace.
[23] redeven:desktop/src/main/main.ts:16551 - The Electron main process registers the shell-open-codespace-window IPC handler.
