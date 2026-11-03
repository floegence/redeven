---
type: Desktop Contract
title: Desktop WSL runtime operations
tags: [desktop, windows, wsl, runtime, bridge, packaging]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Windows11x64 runs Electron, not native Local/container Runtime. Register initialized Linux x64 WSL2 targets; manage only exact distro/user Runtime. Windows owns distro lifecycle. Missing/old/uninitialized targets or broken commands/packages/Bridge need visible explicit recovery.

# Contract

## Discovery and registration
The main process publishes one immutable platform-capability snapshot. Renderer surfaces consume it and never infer the host operating system.

UI recovery copy may show Microsoft WSL commands for the user to run.

## Linux Runtime lifecycle
WSL and SSH host operations consume the same managed-Linux probe, uploaded install, atomic activation, startup report, inventory, exact stop, and verification scripts.

Runtime installs under the Linux user's home-backed `~/.redeven`, never under `/mnt`, and does not require `systemd`.

Only the Environment Stop action stops it.

## Private Bridge and failure behavior
`desktop-bridge` remains a foreground `wsl.exe` child carrying the shared `redeven-desktop-placement-h2/1` HTTP/2 session over private standard input and output.

Multiple registered distributions have independent target ids, processes, Bridges, update state, and lifecycle coordinator keys.

## Package and update boundary
The Windows Desktop bundle uses `managed_wsl_archive` and contains one verified `redeven_linux_amd64.tar.gz`; it must not contain or execute `redeven.exe`.

Public Windows assets remain forbidden until Authenticode signing, signed NSIS update metadata, signing receipts, and a real signed n-1 to n update are enabled together.

# Boundaries

Windows and WSL 2 remain separate authorities. No boundary may be hidden by a native Windows Runtime, SSH-shaped WSL compatibility path, public port, localhost-forwarding dependency, system service, or second lifecycle state machine.

# Evidence

- `redeven:desktop/src/shared/desktopPlatformCapabilities.ts:1` - Source.
- `redeven:desktop/src/main/runtimeHostAccess.ts:1` - Source.
