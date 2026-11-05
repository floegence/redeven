---
type: Security Contract
title: Administrator-authorized remote desktop deployment over SSH
tags: [desktop, ssh, authorization, runtime, security]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Desktop owns SSH authorization/UI lifetime, Floe Native Apps privileged preparation and Runtime service authorization/audit. Every connection ensures current policy and authenticates actual Runtime. Unknown state is preserved. Cancellation reports rollback; verified completion may win but cannot auto-open after cancel.

# Contract

- Only the owning root/main frame of an RWX-authorized SSH environment uses typed deployment IPC. Sensitive admin streams retain no stdout/stderr diagnostics.
- The upstream manager owns ensure/stop/uninstall and supported migrations. Unknown/future/unverifiable ownership remains unchanged. Service readiness, Runtime admission and capture readiness are separate; absent scanout cannot invalidate admitted policy.
- During component preparation, the published manager state is carried through Desktop as an optional, allowlisted `media_state` field. It is accepted only with the `preparing_media` deployment stage; byte totals remain optional and are shown only when measured. States after byte transfer describe verification, installation, validation and packaging work and therefore remain indeterminate until the manager reports readiness.
- A kernel-authenticated root manager holds maintenance ownership. Unknown attachment counts on older services require confirmation. Stage cleanup is independently bounded; transport loss is not rollback proof.
- Linux login-screen capability failures preserve published, redacted reason codes across the native service, Runtime status and launcher. Stale compositor binaries after an OS update (`LOGIN_SESSION_STALE_RUNTIME`) and changed, missing, ambiguous, seat or TTY identities are host-action states with refresh guidance; unsupported desktops remain unsupported. The launcher never falls back to Portal or opens a connection while capture or input authority is unavailable.
- [Launcher](remote-desktop-launcher.md) projects one operation; operation/challenge IDs reject stale replies. Input release, takeover, viewer routing and local Portal/macOS retain their owning contracts.

# Boundaries

Use published dependency contracts and focused deployment/transport/API/locale tests. Historical version-2-to-3 service migration evidence does not pin current dependencies or replace actual Runtime admission.

# Evidence

- desktop/src/main/remoteDesktopDeployment.ts: credential challenge, published manager protocol, proof and cleanup.

- desktop/src/main/remoteDesktopDeployment.test.ts: separate password identities, interruption consent, proof rejection and cancellation.

- desktop/src/main/sshTransportManager.ts: explicit PTY and sensitive stream options.
