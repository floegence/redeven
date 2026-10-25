---
type: Runtime Contract
title: Native Desktop CodeSpace access
description: Bind a Desktop editor origin to one authorized CodeSpace through the current environment transport.
tags: [desktop, codespace, security, transport]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Desktop owns each CodeSpace window, browser profile, protected loopback listener and selected route. Runtime owns editor generation, permissions and AccessGate. Editors use native HTTP/WebSockets without privileged preload or transport injection. Closing a window, revoking access or stopping an instance ends its connections. Route failure and occupied saved ports fail visibly without transport substitution or request replay.

# Contract

- Only the trusted environment root submits `loading`/`open` with a DNS-safe CodeSpace ID. [Window status surfaces](../ui/window-status-surfaces.md) owns presentation.
- One window owner controls loading, navigation, readiness and cleanup. Theme refresh never focuses it. Navigation and route failures use separate localized diagnostics without credentials, raw exceptions or error URLs.
- Profiles hash stable environment/resource identity, including control-plane/user identity where applicable. An occupied port never causes contact with its occupant or a replacement profile origin. External navigation uses the system browser.
- Native/placement sessions reuse their private Local UI bridge and token. No extra Runtime, SSH forward, public Local UI fallback or certificate bypass is allowed. Passwords remain ephemeral, outside editor storage, URLs and logs.
- Descriptors resolve only running CodeSpaces and return the generation and Runtime-owned `access_cookie_name`; full effective read/write/execute permissions and AccessGate are required. Flowersec owns HTTP/Duplex adaptation. Redeven owns routing/authorization and never replays requests or terminal input.

# Boundaries

Compatibility remains defined by the current protocol and published manifests, not historical dependency pins. Electron qualification covers document handoff, readiness, redirects, Workers, Service Workers, WebSockets and unauthenticated rejection. HTTP tests cover generation, authorization, bytes, upgrades, cookies and origin conflicts.

# Evidence

- `redeven:desktop/src/main/codespaceNativeWindows.ts` - Single-window navigation, readiness, cancellation, and bounded failure diagnostics.

- `redeven:desktop/src/main/codespaceNativeWindows.test.ts` - Deterministic document-ordering, retry, concurrent-open, and late-close regression coverage.

- `redeven:desktop/src/shared/desktopShellCodespaceWindowIPC.ts` - ID-only trusted shell request contract.
