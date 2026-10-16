---
type: Security Contract
title: Administrator-authorized remote desktop deployment over SSH
description: Install and manage the Linux physical-desktop service from Env App without target-side graphical consent.
tags: [desktop, ssh, authorization, runtime, security]
timestamp: 2026-10-16T17:00:00Z
---
# Summary

Desktop owns SSH authorization and the lifetime of one UI operation. Published
Floe Native Apps owns the only privileged preparation transaction. Runtime owns
product authorization, read-only service authentication and audit. Every SSH
connection uses **ensure**, including active services whose policy may pin an
older Runtime. It authenticates the actual running Runtime before opening the
physical desktop. Unknown ownership and unsupported records fail unchanged.
Cancellation reports observed rollback; transport loss never proves recovery.
A verified manager completion remains authoritative when commit wins a cancel
race; cancellation still suppresses automatic viewer opening.

# Contract

## Target and administrator authority

Only the main frame and owning root document of an SSH environment may use the
typed deployment IPC. The environment must grant read, write and execute. Status
and session creation explicitly carry the SSH physical-desktop target; missing,
stopped or damaged services never enter Portal consent or a private desktop.
Local current-user sharing and macOS retain their separate platform contracts.

The authorization surface identifies the environment, probed host and SSH user.
It distinguishes that user's sudo password from the actual root password. Root
SSH authority runs directly. Sudo challenges the actual fixed manager bootstrap;
it never infers NOPASSWD from an unrelated command. Root authorization uses system
su in a private SSH PTY, checks the expected challenge and disabled echo, and sends
one password. PAM rejection, missing tools, locked root and unsupported multi-step
challenges end authorization with method switching and dismissal available.
Root SSH, PAM, sudo policy, desktop ACLs and host packages remain unchanged.

Passwords pass only through the transient UI, trusted Desktop main process and
system elevation program. They never enter Runtime APIs, daemon/manager requests,
argv, environment, persistent state, generic SSH logs, audit or diagnostics. Input
state clears on submission or disposal; mutable credential buffers are zeroed.
Ordinary SSH commands stay non-PTY. Sensitive administrator streams retain no
stdout/stderr diagnostics.

## One preparation owner

The published manager accepts ensure, stop and uninstall. Ensure decides install,
repair, supported migration, component upgrade, Runtime rebind or start; there are
no product-side install/update/start mutation routes. Unchanged healthy targets
are verified without restart. Persistent installation policy excludes operation
parameters. Supported records migrate; unknown ownership, future versions and
unverifiable records remain unchanged.

The authorized executing Runtime reports its PID, actual UID/GID, process start
and live executable SHA-256; no cross-user proc access is required. Desktop
verifies the trusted bundled
service kit, transfers fixed files into private staging and prepares verified
media before elevation using a temporary executable from the existing verified
Runtime package cache under the SSH identity, including root SSH. It does not
need access to another user's executable or cache. Renderer input cannot select
executables, hashes, paths
or download sources. Root Runtime admission follows the same peer fingerprint
checks; conversion and encoding still drop to an unprivileged media identity.

The transaction orders ownership/identity checks, verified preparation, maintenance
lease, separate interruption confirmation, application, actual Runtime admission
and commit. Runtime identity is rechecked before application and commit. The actual
Runtime authenticates through the versioned service socket and verifies operation,
challenge and complete target policy digest. Service readiness, Runtime admission
and capture readiness remain distinct: absent scanout cannot undo valid policy.

## Existing attachments and recovery

A kernel-authenticated root manager holds the service maintenance lease. Counting
all view and control attachments and blocking new admission share the same lock.
Existing attachments continue until separate transaction-bound interruption
confirmation. Unknown counts on old services require confirmation. Cancel, expiry
or loss of the lease does not imply consent. Ordinary Runtime admission retains
UID/PID/start/image checks and single-use attachment tickets.

The root-owned journal retains original policy, files, driver configuration and
service enablement/activation. Failed application or admission restores that state
using an independent bounded context. Crash recovery precedes the next management
operation. File and directory publication is synchronized; committed or restored
journals retire atomically before repeatable garbage collection. Recovery never
claims to restore already interrupted connections.

Pipe and PTY use the same versioned JSON control protocol with confirmation,
commit, cancel and five-second heartbeat messages. Fifteen seconds without peer
liveness cancels management. State/authentication reads allow 10 seconds; transfer
stalls allow 30 seconds; media preparation allows 20 minutes; interruption consent
allows two minutes; application allows two minutes; rollback allows 20 seconds.
Desktop retains management transport for 40 seconds after cancel, covering peer
loss detection and rollback, and reports unknown recovery if no result arrives.
Temporary staging cleanup is separately
bounded.

## Product interaction and physical limits

The [launcher](remote-desktop-launcher.md) derives progress and actions from one
operation state. Operation and challenge IDs reject stale responses. The same
surface provides method switching, interruption consent, cancel, close, diagnostic
codes and retry. Closing revokes UI ownership immediately while Desktop collects
bounded cleanup. A later attempt rechecks authoritative state. After commit,
capture or viewer-open failures retry without administrator authorization; failed
or late viewer sessions are released. Popup denial retains a reopening action.

Physical qualification covers Linux GNOME/GDM outputs, including login,
lock and active sessions. It does not create headless or virtual desktops. Root
credentials cannot replace network reachability, verified SSH host identity, PAM
authorization or usable scanout. GPU/capture failures remain capability diagnostics.
Input release, takeover confirmation, viewer origin/path admission and local
Portal/macOS flows retain their owning contracts.

# Boundaries

## Validation evidence

Focused deployment, transport, launcher, API and locale tests consume published
Floe Native Apps v0.23.3 after release and Go proxy/checksum verification. Linux root fixtures verify
self-reported live identity, media command acceptance and both architecture
service-kit bytes. A disposable Linux SSH server exercised real sudo and su/PAM for sudo
password, root password, both wrong-password paths, command-specific NOPASSWD and
locked root. Special-character credentials stayed out of arguments and diagnostic
results. That fixture covers authorization, not systemd or capture.

On 2026-10-16 UTC, udesk26 passed physical acceptance on Ubuntu 26.04.1,
kernel 7.0.0-38-generic and GNOME Wayland (1920 x 1280). Commit 6ed831ea96ea,
epoch 62, consumed published Floe Native Apps v0.23.3 at 3fec2a1d6390. Isolated
Runtime PID 100958 used port 45741 and state
/tmp/redeven-ssh-desktop-acceptance-20261016; Desktop used ports 45731-45733.
Active/stopped version-2 installations with stale fingerprints migrated to
version 3 after actual Runtime admission. The viewer painted GNOME; a temporary
GTK entry/button recorded real keyboard/pointer input. Idempotent ensure retained
service PID 101943 and its viewer. Canceling media preparation or letting consent
expire preserved the original service and allowed retry.

Real systemd tests counted a view-only attachment before separate consent.
Cancellation at verification restored exact policy/unit bytes and active/enabled
state, then retired the journal. Reconnect painted and delivered pointer input
without administrator authorization. SIGKILL at verification preserved the journal;
the next normal Desktop ensure recovered, verified and committed. Sanitized evidence resides under that local path.

udesk26 used NOPASSWD with root locked; password evidence comes from the isolated
PAM fixture. This run did not requalify GDM, lock-screen, macOS or Portal. Cleanup
preserved original Runtime PID 98456 and GNOME, restored its compatible v0.22.48
service and rebound its actual image. That Runtime reported active service and
ready screen/input. Test processes/SSH authorization were removed; no service retained the test image.

# Evidence

- desktop/src/main/remoteDesktopDeployment.ts: credential challenge, published manager protocol, proof and cleanup.
- desktop/src/main/remoteDesktopDeployment.test.ts: separate password identities, interruption consent, proof rejection and cancellation.
- desktop/src/main/sshTransportManager.ts: explicit PTY and sensitive stream options.
- desktop/src/main/main.ts: main-frame/root-document/SSH permissions and actual Runtime verification.
- desktop/src/shared/remoteDesktopDeployment.ts: scoped IPC and sanitized progress.
- internal/codeapp/appserver/remote_desktop.go: authorization, live admission and audit without mutation routes.
- internal/codeapp/appserver/remote_desktop_identity_linux_test.go: executing-process UID/GID, kernel start and live image digest.
- cmd/redeven/desktop_service_media_linux_test.go: root SSH preparation without changing host authority.
- internal/remotedesktop/service_linux_test.go: physical target without Portal fallback.
- internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.test.tsx: operation ownership and viewer recovery.
