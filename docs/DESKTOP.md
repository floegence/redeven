# Desktop Shell

This document describes the public Electron desktop shell that is published together with each `redeven-agent` GitHub Release.

## Goals

- Keep `redeven` as the single runtime authority for agent behavior.
- Ship a desktop installer that bundles the matching `redeven` binary.
- Reuse the existing Local UI over loopback HTTP instead of adding a second UI runtime.

## Architecture

- Electron is a thin shell.
- `redeven run --mode desktop --desktop-managed` remains the only runtime entrypoint.
- The desktop shell waits for a machine-readable startup report file from `redeven`.
- Electron only allows loopback navigation for the reported Local UI origin and opens all other URLs in the system browser.

## Runtime contract

Desktop packages start the bundled binary with:

```bash
redeven run \
  --mode desktop \
  --desktop-managed \
  --local-ui-bind 127.0.0.1:0 \
  --startup-report-file <temp-path>
```

Behavior:

- Local UI always starts.
- Remote control channel is enabled only when the local config is already bootstrapped and remote-valid.
- `--desktop-managed` disables CLI self-upgrade semantics; restart remains available.
- `--startup-report-file` lets Electron wait for a structured readiness signal instead of scraping terminal output.

## Env App behavior

- Desktop-managed Local UI exposes `desktop_managed`, `effective_run_mode`, and `remote_enabled` through the local runtime/version endpoints.
- Env App hides `Update agent` in desktop-managed runs.
- Env App keeps `Restart agent`.
- The maintenance card explains that updates must come from a new desktop release.

## Release assets

Each public `vX.Y.Z` release includes:

- `redeven_linux_amd64.tar.gz`
- `redeven_linux_arm64.tar.gz`
- `redeven_darwin_amd64.tar.gz`
- `redeven_darwin_arm64.tar.gz`
- `Redeven-Desktop-X.Y.Z-linux-x64.AppImage`
- `Redeven-Desktop-X.Y.Z-linux-arm64.AppImage`
- `Redeven-Desktop-X.Y.Z-mac-x64.dmg`
- `Redeven-Desktop-X.Y.Z-mac-arm64.dmg`

Windows is intentionally out of scope for this repository.

## Local development

Desktop package checks:

```bash
./scripts/check_desktop.sh
```

Node.js `24+` is required for desktop package checks and packaging.

Unpackaged Electron runs can point to a local agent binary with:

```bash
cd desktop
REDEVEN_DESKTOP_AGENT_BINARY=../redeven npm run start
```

## code-server scope

The desktop package does not bundle `code-server`.
It keeps the same external `code-server` dependency model that the CLI/runtime already uses.
