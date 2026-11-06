---
type: Security Contract
title: Administrator-authorized remote desktop deployment over SSH
tags: [desktop, ssh, authorization, runtime, security]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Desktop owns SSH authorization/UI lifetime, Floe Native Apps privileged preparation and Runtime service authorization/audit. Every connection ensures current policy and authenticates actual Runtime. Unknown state is preserved. Cancellation reports rollback; verified completion may win but cannot auto-open after cancel.

# Contract

- Only the owning root/main frame of an RWX-authorized SSH environment uses typed deployment IPC. Sensitive admin streams retain no stdout/stderr diagnostics.
- The upstream manager owns ensure/stop/uninstall and supported migrations. Unknown/future/unverifiable ownership remains unchanged. Service readiness, Runtime admission and capture readiness are separate; absent scanout cannot invalidate admitted policy.
- During component preparation, the published manager state is carried through Desktop as an optional, allowlisted `media_state` field. It is accepted only with the `preparing_media` deployment stage; byte totals remain optional and are shown only when measured. States after byte transfer describe verification, installation, validation and packaging work and therefore remain indeterminate until the manager reports readiness.
- Deployment progress separates SSH session startup, host inspection, service package creation, Runtime package preparation, per-file upload, desktop component preparation, service changes and Runtime verification. Runtime downloads and SSH uploads publish measured byte counts when available; upload file identities and transfer direction are allowlisted, and progress is throttled. Unknown totals and local verification/build work stay indeterminate; no percentage or time estimate is inferred.
- Before upload, one SSH batch checks the requested service, graphics worker, license and Runtime bytes against trusted package SHA-256 digests. The SSH identity owns a bounded four-file cache at `$HOME/.cache/redeven/desktop-transfer-v1`; entries are read-only and atomically replaced. Each hit is copied into a private transaction directory and its actual bytes are hashed there. Missing, changed, corrupt or unsafe entries are uploaded individually. Symlinked or untrusted cache directories fail closed. Inspection and publication each have a 30-second bound and accept cancellation; the UI reports inspection without fabricated byte progress or empty metrics.
- Cache reuse is a transport optimization, never proof of installation or authorization. Every connection still runs manager ownership and integrity checks, administrator authorization, actual Runtime admission, challenge/commit and rollback. Transactions clean their staging copies; fixed cache names do not accumulate prior versions.
- A kernel-authenticated root manager holds maintenance ownership. Unknown attachment counts on older services require confirmation. Stage cleanup is independently bounded; transport loss is not rollback proof.
- Linux login-screen capability failures preserve published, redacted reason codes across the native service, Runtime status and launcher. Stale compositor binaries after an OS update (`LOGIN_SESSION_STALE_RUNTIME`) and changed, missing, ambiguous, seat or TTY identities are host-action states with refresh guidance; unsupported desktops remain unsupported. The launcher never falls back to Portal or opens a connection while capture or input authority is unavailable.
- [Launcher](remote-desktop-launcher.md) projects one operation; operation/challenge IDs reject stale replies. Input release, takeover, viewer routing and local Portal/macOS retain their owning contracts.

# Boundaries

Use published dependency contracts and focused deployment/transport/API/locale tests. Historical version-2-to-3 service migration evidence does not pin current dependencies or replace actual Runtime admission.

# Evidence

- desktop/src/main/remoteDesktopDeployment.ts: credential challenge, published manager protocol, proof and cleanup.
- desktop/src/shared/remoteDesktopDeployment.ts and internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.tsx: validated progress events and localized preparation stages.

- desktop/src/main/remoteDesktopDeployment.test.ts: separate password identities, interruption consent, proof rejection and cancellation.
- desktop/src/main/remoteDesktopTransferCache.ts and desktop/tests/remoteDesktopTransferCache.linux.test.mjs: bounded batch inspection, verified independent copies, corruption repair, safe paths and concurrent atomic publication.
- On 2026-11-05, an isolated Node 26 Bookworm Linux container running as UID 1000 checked four cached fixtures totaling 268,436,480 bytes in 1,796 / 1,672 / 1,808 ms, including independent staging copies and SHA-256 verification. All four entries matched; no upload was required. This measures local host inspection, not SSH latency, complete connection time or the udesk26 host.

- desktop/src/main/sshTransportManager.ts: explicit PTY and sensitive stream options.
