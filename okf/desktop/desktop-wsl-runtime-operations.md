---
type: Desktop Contract
title: Desktop WSL runtime operations
description: Windows-only WSL 2 discovery, registration, Linux Runtime lifecycle, private Bridge, and packaging boundaries.
tags: [desktop, windows, wsl, runtime, bridge, packaging]
timestamp: 2026-08-27T00:00:00Z
---
# Summary

Redeven Desktop for Windows 11 x64 runs only the Electron Desktop process. It provides no native Local Environment, Windows Runtime, or local-container Runtime. A user may register one or more initialized Linux x64 WSL 2 distributions as independent WSL Environments. Desktop manages only the Redeven Linux Runtime inside the exact registered distribution and user; Windows retains authority over WSL installation, distribution state, termination, and removal. Missing WSL, WSL 1, initialization failure, missing Linux commands, a vanished distribution, package damage, or Bridge termination fails visibly and requires an explicit retry or lifecycle action.

# Contract

## Discovery and registration

The main process publishes one immutable platform-capability snapshot. Renderer surfaces consume it and never infer the host operating system. Windows disables native Local Environment, native host Runtime, and local-container creation while enabling WSL discovery. Discovery invokes `wsl.exe` with argument arrays, decodes UTF-8 or UTF-16 output, preserves exact distribution names, distinguishes running and stopped distributions, and records the WSL version when Windows reports it.

Discovery does not start a stopped distribution. Registration is user-confirmed and may start only that chosen distribution to verify WSL 2, Linux x64, its effective Linux user and home, and required commands. The registered `wsl_host` stores the exact distribution name and confirmed Linux user. Its target identity also binds the Runtime root. The first registered WSL Environment becomes the default Flower target; users may select another, and deleting the selected registration atomically clears the default. Removing a registration deletes only Desktop metadata and never stops the Runtime or removes WSL data.

Desktop never installs or enables WSL, changes its default distribution or user, converts a distribution, calls WSL shutdown or termination, or unregisters a distribution. UI recovery copy may show Microsoft WSL commands for the user to run.

## Linux Runtime lifecycle

WSL and SSH host operations consume the same managed-Linux probe, uploaded install, atomic activation, startup report, inventory, exact stop, and verification scripts. Their only difference is transport. WSL executes commands as `wsl.exe --distribution <exact-name> --user <confirmed-user> --exec <command> <args...>`.

No product command passes through `cmd.exe`, a PowerShell command string, the default WSL distribution, or shell-interpolated Windows input. Runtime installs under the Linux user's home-backed `~/.redeven`, never under `/mnt`, and does not require `systemd`. Start, Restart, Update, and Open may start the exact selected distribution. Background Desktop startup probes only distributions already reported as running.

Runtime Stop uses the Linux managed manifest and exact process inventory. Desktop never scans Windows process names or stops a distribution. Quitting, updating, or uninstalling Desktop closes windows, sessions, and Bridge children but leaves every WSL Runtime running. Only the Environment Stop action stops it.

## Private Bridge and failure behavior

`desktop-bridge` remains a foreground `wsl.exe` child carrying the shared `redeven-desktop-placement-h2/1` HTTP/2 session over private standard input and output. Desktop exposes only a random Windows `127.0.0.1` proxy and the existing Bridge token. It does not depend on WSL localhost forwarding and introduces no WSL-specific network or Runtime protocol.

External WSL shutdown ends the current Bridge and presents the Environment offline. WSL bridges do not enter SSH automatic transport recovery; only an explicit Open, Start, or Retry may start the distribution and create a new Bridge. Multiple registered distributions have independent target ids, processes, Bridges, update state, and lifecycle coordinator keys.

## Package and update boundary

The Windows Desktop bundle uses `managed_wsl_archive` and contains one verified `redeven_linux_amd64.tar.gz`; it must not contain or execute `redeven.exe`. Startup verifies the archive target, Runtime version, source commit, size, and SHA-256 against the bundle manifest. Start, Update, and Reinstall transfer this embedded archive into WSL and do not require network access inside the distribution.

The internal package is an unsigned, per-user NSIS installer with Desktop auto-update marked unsupported. Desktop installation or replacement never mutates WSL Runtime installations. After restart, each Environment is checked independently and an incompatible Runtime exposes Update Runtime. Public Windows assets remain forbidden until Authenticode signing, signed NSIS update metadata, signing receipts, and a real signed n-1 to n update are enabled together.

# Boundaries

Windows and WSL 2 remain separate authorities. Desktop owns registration metadata, embedded package validation, exact managed Runtime lifecycle, local Bridge processes, and user-facing diagnostics. Windows owns WSL features and distributions; the Linux distribution owns its user and filesystem; Runtime owns its services and persistent data. No boundary may be hidden by a native Windows Runtime, SSH-shaped WSL compatibility path, public port, localhost-forwarding dependency, system service, or second lifecycle state machine.

# Evidence

- `redeven:desktop/src/shared/desktopPlatformCapabilities.ts:1` - Main-owned Windows capability contract.
- `redeven:desktop/src/main/desktopWSL.ts:1` - WSL output decoding, discovery, version observation, and Linux probe.
- `redeven:desktop/src/main/runtimeHostAccess.ts:1` - Exact argument-array WSL command execution and streaming transport.
- `redeven:desktop/src/main/managedLinuxRuntime.ts:1` - Shared managed-Linux install, lifecycle, inventory, and stop path.
- `redeven:desktop/src/main/runtimePlacementBridgeSession.ts:1` - Private WSL stdio Bridge and loopback proxy.
- `redeven:desktop/src/main/desktopBundle.ts:1` - Windows managed archive manifest validation.
- `redeven:desktop/electron-builder.config.mjs:1` - Internal per-user NSIS package and unsupported update policy.
- `redeven:.github/workflows/windows-wsl-certification.yml:1` - Exact-main Windows 2025 and two-distribution certification.
