<p align="center">
  <img src="assets/brand/redeven/svg/app-icon.svg" alt="Redeven" width="120">
</p>

# Redeven

<p align="center">
  <strong>Your computers &amp; servers, in one browser tab.</strong><br>
  Terminal, file browser, IDE, and AI —
  <br>all on your own hardware, end-to-end encrypted.
</p>

<p align="center">
  <a href="https://github.com/floegence/redeven/releases">Download Desktop</a> |
  <a href="#quick-start">Install CLI</a> |
  <a href="#what-you-can-do">Features</a> |
  <a href="#security">Security</a> |
  <a href="#documentation">Docs</a>
</p>

<p align="center">
  <a href="https://go.dev/"><img alt="Go Version" src="https://img.shields.io/badge/Go-1.26.3-00ADD8?style=flat-square&logo=go"></a>
  <a href="https://nodejs.org/"><img alt="Node Version" src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js"></a>
  <a href="okf/index.md"><img alt="OKF Knowledge" src="https://img.shields.io/badge/Knowledge-OKF%20v0.1-6C3BFF?style=flat-square"></a>
  <a href="https://github.com/floegence/redeven/releases"><img alt="Releases" src="https://img.shields.io/badge/Releases-GitHub-181717?style=flat-square&logo=github"></a>
</p>

## What is Redeven?

Redeven is a single binary that brings your computers and servers into one browser tab. Instead of juggling SSH terminals, file browsers, monitoring dashboards, port forwarding, and IDE windows, you get one unified workspace on the hardware you already control.

It runs on your machine, your remote servers, or any reachable SSH host. Your files, processes, API keys, and credentials stay where they belong — Redeven does not move your plaintext through anyone else's infrastructure.

- **Clients connect to an endpoint runtime** — Browser, Desktop, CLI, and SSH-hosted sessions all enter the same runtime-managed workspace.
- **The runtime is the trust boundary** — a single Go binary owns files, terminals, monitoring, Git, web-service forwarding, Workbench layout, notes, Browser Editor setup, Flower, and Codex bridge access.
- **Transport and policy stay explicit** — Flowersec carries encrypted RPC and stream traffic, while session grants, local permission policy, filesystem scope, and local secrets constrain what each session can do.

![Redeven architecture overview](assets/readme/architecture-overview.png)

## Quick start

Two paths to get started: Desktop (recommended for most users) or CLI.

### Desktop App

1. Download Redeven Desktop from [GitHub Releases](https://github.com/floegence/redeven/releases).
2. Open the app. Choose your environment: Local, Provider, SSH Host, or a saved URL.
3. Start working — the workspace opens in your browser automatically.

For remote machines: Desktop can auto-install the matching Redeven release over SSH, then explicitly connect that managed SSH runtime to a provider Environment when you choose to. No manual setup on the remote host.

### CLI

```bash
# 1. Install
curl -fsSL https://raw.githubusercontent.com/floegence/redeven/main/scripts/install.sh | sh

# 2. Bootstrap (one-time, requires a ticket from your provider)
redeven bootstrap \
  --controlplane https://<your-provider> \
  --env-id <env_public_id> \
  --bootstrap-ticket <bootstrap_ticket>

# 3. Run
redeven run --mode hybrid

# 4. Open http://localhost:23998 in your browser.
```

Bootstrap writes your Local Environment config to `~/.redeven/local-environment/config.json`. Each OS user has one Local Environment identity, bound to one provider Environment at a time. Desktop and browser flows use the same one-time ticket contract.

Interactive terminals use Redeven's rich runtime presentation by default: a compact animated character mark, runtime version/protocol details, active session/workload counts, Local UI and Environment URLs, real runtime log tailing, and actionable warning/error panels. Use the arrow keys to move between Control plane, Sessions, and Logs. Press Enter on Sessions to open a filterable active-session view, Enter on Logs to expand the full runtime log view, Enter on Control plane to connect, disconnect, or open the bootstrap setup fields, Esc to return, and Ctrl+C to stop the runtime. Non-interactive shells fall back to plain text, and Desktop-managed launches use the machine presentation contract with structured startup reports instead of terminal UI.

**Run modes at a glance:**

| Goal | Command |
|---|---|
| Local UI only (this device) | `redeven run --mode local` |
| Local UI + remote control channel | `redeven run --mode hybrid` |
| Desktop-managed runtime | `redeven run --mode desktop --desktop-managed --presentation machine --local-ui-bind localhost:23998` |
| Expose to another trusted device | `REDEVEN_LOCAL_UI_PASSWORD=<password> redeven run --mode hybrid --local-ui-bind 0.0.0.0:23998 --password-env REDEVEN_LOCAL_UI_PASSWORD` |

## What you can do

| Surface | What it gives you |
|---|---|
| Files and Git | File upload/download, inline preview/edit, folder-scoped Git changes, diffs, and stash workflows. |
| Terminal | Multi-tab terminals rooted in the directories you are working with, under the same runtime permission model. |
| Monitor | CPU, memory, disk, network, and process views from the endpoint runtime. |
| Browser Editor | Browser editor sessions set up explicitly by Desktop, isolated per workspace. |
| Web Services | Runtime-managed service registration and port-forward access without hand-written SSH tunnels. |
| Flower and Codex | Optional AI surfaces that use runtime-validated tools and local model/host configuration. |
| Desktop | Native launcher for local, provider-hosted, SSH-bootstrapped, and saved Local UI environments. |

## Security, without stealing the spotlight

Redeven leads with capability, but the runtime is still the trust boundary because it owns the real host.

- The runtime lives on the endpoint and keeps plaintext there.
- The control plane issues bootstrap payloads, grants, and immutable session metadata.
- [Flowersec](https://github.com/floegence/flowersec) carries encrypted bytes between the client and the endpoint runtime; current runtime integration is documented against `flowersec-go/v0.19.9`.
- Effective permissions come from server-issued session grants, clamped by the local permission policy (`read`, `write`, `execute`, `admin` — no category implies any other).
- Local config, E2EE material, audit logs, and diagnostics stay in the endpoint state directory.
- GitHub Releases remain the public source of truth for binaries, checksums, signatures, and OKF verification assets.

## Documentation

Redeven keeps maintained repository knowledge in [OKF v0.1](okf/index.md). The OKF corpus is generated from current source-level behavior and is embedded into the runtime for `okf.search`.

Machine-readable provider integration surface lives in [spec/openapi/rcpp-v2.yaml](spec/openapi/rcpp-v2.yaml). Root-level maintained Markdown is intentionally limited to `AGENTS.md`, `README.md`, and `THIRD_PARTY_NOTICES.md`.

## For developers

Build, lint, and verify from source.

<details>
<summary>Build from source</summary>

### Prerequisites

- Go `1.26.3`
- Node.js `24`
- npm
- pnpm or Node.js `corepack`

### Build

```bash
./scripts/lint_ui.sh
./scripts/check_desktop.sh
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

### Local guardrails

```bash
./scripts/install_git_hooks.sh
node scripts/generate_third_party_notices.mjs --check
```

Notes:

- `internal/**/dist/` assets are generated and embedded via Go `embed`.
- Frontend `dist` assets are not checked into git. The tracked exception is `okf/dist/*`, which stays committed as verifiable OKF bundle release metadata.
- `THIRD_PARTY_NOTICES.md` is generated from Go modules and JavaScript lockfiles. Run `node scripts/generate_third_party_notices.mjs` after dependency changes, then keep `--check` green.
- `./scripts/lint_ui.sh`, `./scripts/check_desktop.sh`, `./scripts/build_assets.sh`, and `go test ./...` are the main source-level checks.
- `./scripts/dev_desktop.sh` starts Desktop from the current checkout or worktree with a freshly bundled runtime.
- `cd desktop && npm run start` and `cd desktop && npm run package` prepare `desktop/.bundle/<goos>-<goarch>/redeven` before Electron starts or packages the desktop shell.

</details>

<details>
<summary>Local state, release paths, and troubleshooting</summary>

- Local Environment state defaults to `~/.redeven/local-environment/`; Desktop and standalone runtime mode also share the profile catalog under `~/.redeven/catalog/`.
- GitHub Releases are the public source of truth for versioned CLI tarballs, Desktop installers, checksums, signatures, and OKF verification assets.
- For current implementation details, query the embedded OKF bundle with `okf.search` or inspect [okf/index.md](okf/index.md).

</details>

## License

Redeven is licensed under the [MIT License](LICENSE). Third-party dependency notices are tracked in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); release archives and Desktop packages include these files alongside the runtime artifacts.

## Open-source scope

This public repository covers the endpoint/runtime layer, Redeven Local UI behavior, the desktop shell, and the GitHub Release contract.

Organization-specific deployment automation, control-plane implementations, and site-specific packaging wrappers are intentionally out of scope here.
