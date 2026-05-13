<p align="center">
  <img src="assets/brand/redeven/svg/app-icon.svg" alt="Redeven" width="120">
</p>

# Redeven

<p align="center">
  <strong>One browser tab for everything on your server.</strong><br>
  File browser, terminal, system monitor, port forwarding, browser IDE, and AI assistant —
  <br>all in one place, end-to-end encrypted.
</p>

<p align="center">
  <a href="https://github.com/floegence/redeven/releases">Download Desktop</a> |
  <a href="#quick-start">Install CLI</a> |
  <a href="#what-you-can-do">Features</a> |
  <a href="#security">Security</a> |
  <a href="#documentation">Docs</a>
</p>

<p align="center">
  <a href="https://go.dev/"><img alt="Go Version" src="https://img.shields.io/badge/Go-1.25.9-00ADD8?style=flat-square&logo=go"></a>
  <a href="https://nodejs.org/"><img alt="Node Version" src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js"></a>
  <a href="docs/ENV_APP.md"><img alt="Local Environment Workspace" src="https://img.shields.io/badge/Local%20Environment-Workspace-6C3BFF?style=flat-square"></a>
  <a href="docs/CODE_APP.md"><img alt="Browser IDE" src="https://img.shields.io/badge/Browser-IDE-007ACC?style=flat-square"></a>
  <a href="docs/DESKTOP.md"><img alt="Desktop App" src="https://img.shields.io/badge/Desktop-App-47848F?style=flat-square&logo=electron"></a>
  <a href="docs/AI_AGENT.md"><img alt="AI Assistance" src="https://img.shields.io/badge/AI-Assistance-FF4FA3?style=flat-square"></a>
  <a href="https://github.com/floegence/redeven/releases"><img alt="Releases" src="https://img.shields.io/badge/Releases-GitHub-181717?style=flat-square&logo=github"></a>
</p>

## What is Redeven?

Redeven is a single binary that gives every machine a complete control panel you open in the browser. Instead of juggling SSH terminals, file browsers, monitoring dashboards, port forwarding, and IDE windows, you get one unified workspace.

It runs on your machine, your remote servers, or any reachable SSH host. Your files, processes, API keys, and credentials stay where they belong — Redeven does not move your plaintext through anyone else's infrastructure.

- **Browser or Desktop** — open your workspace from any browser, or use the native Desktop app for local and remote sessions.
- **No agent protocol, no remote Node.js** — the runtime is a single Go binary. The optional browser IDE (code-server) is installed on demand, not bundled.
- **AI that works where your data lives** — optional on-device AI assistance reads files, runs commands, and completes tasks under the same permission model as the rest of the workspace.

![Redeven architecture overview](docs/images/readme-architecture-overview.jpeg)

## Quick start

Two paths to get started: Desktop (recommended for most users) or CLI.

### Desktop App

1. Download Redeven Desktop from [GitHub Releases](https://github.com/floegence/redeven/releases).
2. Open the app. Choose your environment: Local, Provider, SSH Host, or a saved URL.
3. Start working — the workspace opens in your browser automatically.

For remote machines: Desktop can auto-install the matching Redeven release over SSH. No manual setup on the remote host. See [`docs/DESKTOP.md`](docs/DESKTOP.md) for details.

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

**Run modes at a glance:**

| Goal | Command |
|---|---|
| Local UI only (this device) | `redeven run --mode local` |
| Local UI + remote control channel | `redeven run --mode hybrid` |
| Desktop-managed runtime | `redeven run --mode desktop --desktop-managed --local-ui-bind localhost:23998` |
| Expose to another trusted device | `REDEVEN_LOCAL_UI_PASSWORD=<password> redeven run --mode hybrid --local-ui-bind 0.0.0.0:23998 --password-env REDEVEN_LOCAL_UI_PASSWORD` |

## What you can do

| Surface | What it gives you | Read |
|---|---|---|
| Files and Git | File upload/download, inline preview/edit, folder-scoped Git changes, diffs, and stash workflows. | [`docs/ENV_APP.md`](docs/ENV_APP.md) |
| Terminal | Multi-tab terminals rooted in the directories you are working with, under the same runtime permission model. | [`docs/ENV_APP.md`](docs/ENV_APP.md) |
| Monitor | CPU, memory, disk, network, and process views from the endpoint runtime. | [`docs/ENV_APP.md`](docs/ENV_APP.md) |
| Code App | code-server workspaces installed and managed on demand, isolated per codespace. | [`docs/CODE_APP.md`](docs/CODE_APP.md) |
| Web Services | Runtime-managed service registration and port-forward access without hand-written SSH tunnels. | [`docs/ENV_APP.md`](docs/ENV_APP.md) |
| Flower and Codex | Optional AI surfaces that use runtime-validated tools and local model/host configuration. | [`docs/AI_AGENT.md`](docs/AI_AGENT.md), [`docs/AI_SETTINGS.md`](docs/AI_SETTINGS.md), [`docs/CODEX_UI.md`](docs/CODEX_UI.md) |
| Desktop | Native launcher for local, provider-hosted, SSH-bootstrapped, and saved Local UI environments. | [`docs/DESKTOP.md`](docs/DESKTOP.md) |

## Security, without stealing the spotlight

Redeven leads with capability, but the runtime is still the trust boundary because it owns the real host.

- The runtime lives on the endpoint and keeps plaintext there.
- The control plane issues bootstrap payloads, grants, and immutable session metadata.
- [Flowersec](https://github.com/floegence/flowersec) carries encrypted bytes between the client and the endpoint runtime.
- Effective permissions come from server-issued session grants, clamped by the local permission policy (`read`, `write`, `execute`, `admin` — no category implies any other).
- Local config, E2EE material, audit logs, and diagnostics stay in the endpoint state directory.
- GitHub Releases remain the public source of truth for binaries, checksums, and signatures.

Read the full contract in [`docs/CAPABILITY_PERMISSIONS.md`](docs/CAPABILITY_PERMISSIONS.md), [`docs/PERMISSION_POLICY.md`](docs/PERMISSION_POLICY.md), and [`docs/RELEASE.md`](docs/RELEASE.md).

## Documentation

### By task

| I want to... | Read |
|---|---|
| Work with files, terminals, monitoring, notes, ports, and settings | [`docs/ENV_APP.md`](docs/ENV_APP.md) |
| Run a browser IDE through Redeven | [`docs/CODE_APP.md`](docs/CODE_APP.md) |
| Package, operate, or debug Redeven Desktop | [`docs/DESKTOP.md`](docs/DESKTOP.md) |
| Configure optional AI assistance | [`docs/AI_AGENT.md`](docs/AI_AGENT.md), [`docs/AI_SETTINGS.md`](docs/AI_SETTINGS.md) |
| Connect Codex to the same workspace | [`docs/CODEX_UI.md`](docs/CODEX_UI.md) |
| Review permissions and trust boundaries | [`docs/CAPABILITY_PERMISSIONS.md`](docs/CAPABILITY_PERMISSIONS.md), [`docs/PERMISSION_POLICY.md`](docs/PERMISSION_POLICY.md) |
| Integrate a compatible control plane provider | [`RCPP v1 spec`](docs/protocol/rcpp-v1.md), [`RCPP v1 OpenAPI`](docs/openapi/rcpp-v1.yaml) |
| Refresh or audit the embedded knowledge bundle | [`docs/KNOWLEDGE.md`](docs/KNOWLEDGE.md) |
| Verify releases and artifacts | [`docs/RELEASE.md`](docs/RELEASE.md) |

## For developers

Build, lint, and verify from source.

<details>
<summary>Build from source</summary>

### Prerequisites

- Go `1.25.9`
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
- Frontend `dist` assets are not checked into git. The tracked exception is `internal/knowledge/dist/*`, which stays committed as verifiable knowledge bundle release metadata.
- `THIRD_PARTY_NOTICES.md` is generated from Go modules and JavaScript lockfiles. Run `node scripts/generate_third_party_notices.mjs` after dependency changes, then keep `--check` green.
- `./scripts/lint_ui.sh`, `./scripts/check_desktop.sh`, `./scripts/build_assets.sh`, and `go test ./...` are the main source-level checks.
- `./scripts/dev_desktop.sh` starts Desktop from the current checkout or worktree with a freshly bundled runtime.
- `cd desktop && npm run start` and `cd desktop && npm run package` prepare `desktop/.bundle/<goos>-<goarch>/redeven` before Electron starts or packages the desktop shell.

</details>

<details>
<summary>Local state, release paths, and troubleshooting</summary>

- Local Environment state defaults to `~/.redeven/local-environment/`; Desktop and standalone runtime mode also share the profile catalog under `~/.redeven/catalog/`.
- GitHub Releases are the public source of truth for versioned CLI tarballs, Desktop installers, checksums, and signatures. See [`docs/RELEASE.md`](docs/RELEASE.md).
- For feature-specific troubleshooting, start with [`docs/ENV_APP.md`](docs/ENV_APP.md), [`docs/CODE_APP.md`](docs/CODE_APP.md), and [`docs/DESKTOP.md`](docs/DESKTOP.md).

</details>

## License

Redeven is licensed under the [MIT License](LICENSE). Third-party dependency notices are tracked in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); release archives and Desktop packages include these files alongside the runtime artifacts.

## Open-source scope

This public repository covers the endpoint/runtime layer, Redeven Local UI behavior, the desktop shell, and the GitHub Release contract.

Organization-specific deployment automation, control-plane implementations, and site-specific packaging wrappers are intentionally out of scope here.
