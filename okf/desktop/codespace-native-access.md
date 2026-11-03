---
type: Runtime Contract
title: Native Desktop CodeSpace access
tags: [desktop, codespace, security, transport]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Desktop owns CodeSpace window/profile/loopback listener/route; Runtime owns editor generation/permissions/AccessGate. Native HTTP/WebSockets need no privileged preload. Close/revoke/stop ends connections; route or saved-port failure never substitutes transport or replays requests.

# Contract

- Only the trusted environment root submits `loading`/`open` with a DNS-safe CodeSpace ID. [Window status surfaces](../ui/window-status-surfaces.md) owns presentation.
- One window owner controls loading, navigation, readiness and cleanup. Theme refresh never focuses it. Navigation and route failures use separate localized diagnostics without credentials, raw exceptions or error URLs.
- Profiles hash stable environment/resource identity, including control-plane/user identity where applicable. An occupied port never causes contact with its occupant or a replacement profile origin. External navigation uses the system browser.
- Native/placement sessions reuse their private Local UI bridge and token. No extra Runtime, SSH forward, public Local UI fallback or certificate bypass is allowed. Passwords remain ephemeral, outside editor storage, URLs and logs.
- Descriptors resolve only running CodeSpaces and return the generation and Runtime-owned `access_cookie_name`; full effective read/write/execute permissions and AccessGate are required. Flowersec owns HTTP/Duplex adaptation. Redeven owns routing/authorization and never replays requests or terminal input.

# Boundaries

Compatibility remains defined by the current protocol and published manifests, not historical dependency pins. Electron qualification covers document handoff, readiness, redirects, Workers, Service Workers, WebSockets and unauthenticated rejection. HTTP tests cover generation, authorization, bytes, upgrades, cookies and origin conflicts.

Descriptor acquisition uses the real environment Electron session and its [private bridge request policy](../security/plugin-platform-integration-security.md), including the global request hook. A mocked `fetch` or raw socket route alone cannot qualify this boundary.

# Evidence

- `redeven:desktop/src/main/codespaceNativeWindows.ts` - Source.
- `redeven:desktop/src/main/codespaceNativeWindows.test.ts` - Tests.
- `redeven:desktop/src/shared/desktopShellCodespaceWindowIPC.ts` - Source.
- `redeven:desktop/scripts/check-codespace-native-electron.mjs` - Supervised Electron descriptor/forwarding qualification. Run from `desktop`; `--real-editor` builds the Local UI test fixture and verifies workbench loading, file edit/save, terminal execution and reopen through the real private bridge. Build embedded assets first and provide an installed published editor via `REDEVEN_CODE_SERVER_BIN` when needed. `REDEVEN_NATIVE_ACCEPTANCE_REPORT` optionally retains the final scenario/cleanup report.

- `redeven:desktop/scripts/check-codespace-native-electron.mjs` - Tests.
