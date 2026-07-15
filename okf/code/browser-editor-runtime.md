---
type: Runtime Contract
title: Browser Editor runtime
description: Code App serves Browser Editor codespaces through the local app server and managed code workspace engine APIs.
tags: [code-app, browser-editor, local-ui, desktop]
timestamp: 2026-07-15T00:00:00Z
---

Browser Editor support is owned by the Code App app server. Codespaces are opened through Local UI `/cs/<id>/` routes or through remote `cs-*` sandbox hosts, while Desktop and Env App can prepare or update managed Browser Editor runtime versions through code workspace engine APIs.

# Mechanism

The Code App app server backend owns codespace lifecycle, port resolution, managed runtime status, import sessions, chunk upload, completion, version selection, version removal, and operation cancellation. Local UI routes `/cs/*` to the app server. Runtime-control mirrors the code workspace engine import flow for Desktop-managed setup. Managed workspace engine imports validate package checksums, compressed archive size, and extracted regular file totals with a 2 GiB safety cap. The code-server runner starts the editor bound to loopback with no editor auth, an absolute proxy base path under `/cs/<code_space_id>`, disabled telemetry/update checks, scoped data directories, and a short stable session socket path.

Remote Code App navigation keeps the Flowersec controller bridge bound to the isolated `app-*` origin. A compatible control plane can place its controller-issued bridge capability nonce and signed `proxy.runtime@1` WebSocket frame limit in that origin's session storage before replacing the bootstrap URL. The injected Redeven bridge restores those values after navigation or refresh and passes them to `registerProxyAppWindow`. Stored frame limits must be positive safe integers and cannot widen Redeven's existing 32 MiB product cap; malformed or oversized values use that cap. If both values are absent, the bridge retains the legacy no-nonce and 32 MiB registration used by older control-plane releases. This rolling fallback does not change target-origin routing, Flowersec wire framing, proxy protocol v1, or Redeven RPC payloads.

Env App chooses an explicit codespace open target before starting the space: `desktop_window` opens a dedicated Desktop codespace window through the shell bridge, while `system_browser` keeps using the existing external browser path. When the Desktop bridge exposes codespace-window support, a running codespace presents Desktop as the primary action with Browser in the adjacent menu; a stopped codespace keeps Start primary and offers both open targets from its menu. Start and Desktop-open actions enter an in-place busy state with the shared shimmer affordance so the card does not appear idle while runtime checks, start, ticket minting, or navigation are still pending.

Browser Editor preparation uses one shared semantic activity model across Codespaces and Settings. Codespaces presents the activity as a full-width, balanced operational band with status and actions beside either the four setup steps or a detected-versus-required platform diagnosis; Settings uses the compact layout of the same component. Runtime platform results with `supported=false` and `unsupported_os`, `unsupported_arch`, or `unsupported_libc` are terminal, non-retryable setup results, while release lookup, download, transfer, import, and verification failures remain retryable. Technical paths, error codes, and logs stay collapsed under technical details by default. The Codespaces empty or populated content remains a separate page region below the preparation band.

Desktop exposes a typed `redeven-desktop:shell-open-codespace-window` IPC request with `loading` and `navigate` modes. The trusted Env App renderer calls `loading` immediately for Desktop-open flows so Desktop can create or focus a native codespace window with a local, scriptless, CSP-bound loading document before the codespace URL exists. After start, local URL construction, or remote entry-ticket minting succeeds, Env App calls `navigate` with `{ url, code_space_id }`; legacy callers that omit `mode` but include `url` are normalized to `navigate`.

The main process validates the sender session for both modes. `loading` only creates or reuses the per-session, per-codespace child window and can later show an error state in that same window. `navigate` continues to check that the URL is both allowed for the session and specifically targets the requested codespace before loading it. Accepted codespace windows use the parent session partition for remote-session continuity, reuse one window per session and codespace id, use native OS chrome with no Desktop preload, and keep `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`. Navigation inside that window is limited to the matching local `/cs/<id>/` path or a remote hostname whose first label is `cs-<id>`; other navigations and opened links are sent to the system browser.

# Boundaries

Opening or managing Browser Editor is not just a static file route. Version setup and removal require full read/write/execute runtime permissions, while status reads require read permission. The session-scoped bridge values are transport bootstrap inputs for the current isolated app origin; they do not grant broader runtime permissions or replace controller source, origin, and capability validation.

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
[14] redeven:internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.tsx:198 - Env App opens or updates the Desktop codespace loading window through the shell bridge before navigation.
[15] redeven:internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.tsx:457 - The codespace card makes Desktop the running-card primary action when the bridge is available and keeps Browser in the menu.
[16] redeven:desktop/src/shared/desktopShellCodespaceWindowIPC.ts:3 - Desktop shell codespace-window IPC defines loading and navigate request variants.
[17] redeven:desktop/src/preload/desktopShell.ts:70 - The trusted Desktop preload exposes `openCodespaceWindow` through the shell bridge.
[18] redeven:desktop/src/main/navigation.ts:212 - Desktop recognizes codespace URLs by local `/cs/<id>/` paths or remote `cs-<id>` host labels.
[19] redeven:desktop/src/main/navigation.ts:239 - Codespace window navigation must pass both the session allow-list and the codespace URL check.
[20] redeven:desktop/src/main/main.ts:6902 - Desktop builds a local CSP-bound loading document for codespace child windows.
[21] redeven:desktop/src/main/main.ts:7061 - Codespace child windows use the session partition, native chrome, and no Desktop preload.
[22] redeven:desktop/src/main/main.ts:7111 - Desktop shell codespace-window requests branch between loading and validated navigate modes.
[23] redeven:desktop/src/main/main.ts:16734 - The Electron main process registers the shell-open-codespace-window IPC handler.
[24] redeven:internal/envapp/ui_src/src/ui/services/browserEditorSetupActivity.ts:108 - Browser Editor activity derives structured, non-retryable platform diagnoses from Runtime status.
[25] redeven:internal/envapp/ui_src/src/ui/pages/BrowserEditorSetupActivityPanel.tsx:80 - The shared setup component renders wide and compact layouts from the same activity contract.
[26] redeven:internal/envapp/ui_src/src/ui/pages/EnvCodespacesPage.tsx:862 - Codespaces uses the wide operational layout while preserving the separate codespace content region.
[27] redeven:internal/envapp/ui_src/src/ui/pages/settings/CodeRuntimeSettingsCard.tsx:401 - Settings uses the compact Browser Editor activity layout.
[28] redeven:internal/codeapp/ui_src/src/runtimeBridge.ts:63 - Code App restores the session-scoped bridge capability and WebSocket frame limit with the legacy fallback.
[29] redeven:internal/codeapp/ui_src/src/runtimeBridge.test.ts:81 - Focused tests cover restored capability values, malformed limits, and unavailable storage.
