---
type: Security Contract
title: Administrator-authorized remote desktop deployment over SSH
description: Install and manage the Linux physical-desktop service from Env App without target-side graphical consent.
tags: [desktop, ssh, authorization, runtime, security]
timestamp: 2026-10-08T08:00:00Z
---
# Summary

Redeven Desktop owns the SSH transaction; Env App owns scope confirmation and
ephemeral administrator input. Published `floe-native-apps` owns the privileged
Linux deployment transaction, systemd service, DRM/KMS capture and uinput devices.
SSH plus administrator authority is sufficient for qualified GNOME/GDM hosts.
The target never needs a Portal dialog or local interaction approval. Failed or
canceled deployment reports observed rollback; uncertainty is not success.

# Contract

## Consent, credentials and admission

Only the root Env App document of an SSH environment may invoke the typed Desktop
deployment bridge. Requests name a fixed operation: install, update, start, stop
or uninstall. A management request must carry explicit confirmation. The dialog
explains root authority, lock-screen capture and keyboard/pointer injection, the
private Unix socket, uninstall and the exclusion of disk encryption unlocking.

The Runtime authorizes each deployment using full environment read/write/execute
permission and records fixed action/outcome/rollback codes. Its audit route does
not execute installation or accept credentials. Service status is read-only.
Runtime service mutation routes reject elevation with an SSH authorization code.

An administrator password is cleared from the dialog before execution and is
never placed in preferences, URLs, command arguments, environment variables,
audit, diagnostics, the Runtime API or the desktop daemon. Desktop sends it to
sudo's input stream only after sudo reports that it is needed. Root or existing
passwordless authority receives no unused password. Credential buffers are
cleared when the transaction finishes; cancel or navigation revokes its owner.

## Deployment and rollback

Desktop extracts the published service kit from its trusted bundled Runtime.
The renderer cannot select artifacts, commands, hashes, destinations or network
sources. Desktop probes the target architecture and actual Runtime process,
binds its UID/GID and executable SHA-256, verifies kit bytes, and transfers only
the fixed deployment files through a private SSH staging directory.
The full-permission authorization response supplies the executing Runtime's PID;
the bridge carrier's startup metadata is not process authority. Authorization
reads share the operation's cancellation and a bounded deadline. Public health
responses do not gain process information for this deployment workflow.

The privileged manager publishes root-owned immutable executables and license,
a private installed policy, a fixed systemd unit and uinput boot configuration.
It enables and starts the service. Explicit directory permissions allow the
unprivileged converter to traverse its executable path even when SSH uses umask
0077; policy remains mode 0600. No driver library, desktop ACL or host package is
modified. Runtime startup remains owned by Desktop's existing SSH Runtime flow.

The management input stays open as a transaction lifeline. Cancel, document
navigation, shutdown or SSH loss closes it. The manager rolls back prior files,
unit, enablement, activation and directory permissions using an independent
bounded cleanup context. Desktop waits for the rollback result before returning;
it does not kill SSH and guess that cancellation succeeded. Failure reports
complete, failed or unknown rollback, and removes task-owned staging files.
Uninstall removes the owned unit, policy, binaries and boot configuration.

## Service authority and capability

The service has no network listener. A root-owned Unix socket admits only the
administrator-pinned Runtime UID/image, validates peer PID/start time and image
identity, and consumes a one-use attachment token. Image replacement requires
deployment update to authorize the new bytes. Restarting the same Runtime image
opens a fresh attachment without changing the installed policy.

DRM export and EGL conversion use separate processes and an inherited private
descriptor. The exporter retains device authority; conversion runs as the
Runtime user after dropping Linux capabilities. User homes stay hidden. A fixed
unprivileged child may wake an already-qualified Mutter output without injecting
pre-frame input or unlocking the session.

Current qualification covers GNOME/GDM on active physical outputs. Disconnected
outputs, absent scanout, unsupported GPU layouts and unsupported compositors
report capability reasons even if systemd is running. Installed stopped/failed
services never silently fall back to Portal or an application-private desktop.
The panel translates these reasons and offers no target-side approval action.

Each attachment owns uinput devices. Disconnect, takeover, generation changes,
user switching, service stop and Runtime death release held events and retire
painted authority. Control is relinquished before a slow capture worker is reaped.
Lock-screen input additionally follows the [desktop session contract](remote-desktop.md):
explicit unlock mode, physical events, current generation and painted frame.
Neither passwords nor key contents appear in service logs.

# Boundaries

This Linux service does not certify other compositors, Windows hosts, encrypted
disk unlock, macOS loginwindow access, multi-output selection, audio or clipboard.
Advertised capabilities and actual qualification remain authoritative. The
optional current-user chain has a separate Portal authorization contract.

# Evidence

- `desktop/src/main/remoteDesktopDeployment.ts` and its tests: fixed SSH operations, sudo credential separation, cancellation and rollback.
- `desktop/src/main/main.ts` and `desktop/src/preload/desktopShell.ts`: Env App document ownership, private bridge authorization and IPC validation.
- `cmd/redeven/desktop_service_kit.go` and its tests: published kit extraction and artifact identity.
- `internal/codeapp/appserver/remote_desktop.go` and its tests: full permission, audit and rejection of unknown credential fields.
- `internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.tsx` and its tests: consent, clearing input, progress and failure presentation.
- Published `floe-native-apps/hostdesktop` deployment, socket, uinput and opt-in real-systemd qualification tests: upstream installation and physical-desktop authority.
