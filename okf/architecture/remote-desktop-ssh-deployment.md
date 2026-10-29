---
type: Security Contract
title: Administrator-authorized remote desktop deployment over SSH
tags: [desktop, ssh, authorization, runtime, security]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Desktop owns SSH authorization and UI-operation lifetime; published Floe Native Apps owns privileged preparation; Runtime owns product authorization, service authentication and audit. Every SSH connection runs ensure, including active older-policy services, and authenticates the actual Runtime before opening. Unknown records remain unchanged. Cancellation reports observed rollback; verified completion may win the race but still suppresses automatic viewer opening.

# Contract

- Only the owning root/main frame of an RWX-authorized SSH environment uses typed deployment IPC. Sensitive admin streams retain no stdout/stderr diagnostics.
- The upstream manager owns ensure/stop/uninstall and supported migrations. Unknown/future/unverifiable ownership remains unchanged. Service readiness, Runtime admission and capture readiness are separate; absent scanout cannot invalidate admitted policy.
- A kernel-authenticated root manager holds maintenance ownership. Unknown attachment counts on older services require confirmation. Stage cleanup is independently bounded; transport loss is not rollback proof.
- [Launcher](remote-desktop-launcher.md) projects one operation; operation/challenge IDs reject stale replies. Input release, takeover, viewer routing and local Portal/macOS retain their owning contracts.

# Boundaries

Use published dependency contracts and focused deployment/transport/API/locale tests. Historical version-2-to-3 service migration evidence does not pin current dependencies or replace actual Runtime admission.

# Evidence

- desktop/src/main/remoteDesktopDeployment.ts: credential challenge, published manager protocol, proof and cleanup.

- desktop/src/main/remoteDesktopDeployment.test.ts: separate password identities, interruption consent, proof rejection and cancellation.

- desktop/src/main/sshTransportManager.ts: explicit PTY and sensitive stream options.
