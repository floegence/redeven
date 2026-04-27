<p align="center">
  <img src="desktop/build/icon.svg" alt="Redeven" width="120">
</p>

# Redeven

<p align="center">
  <strong>Secure the real machine, not just the browser tab.</strong><br>
  Turn any machine into a secure workspace endpoint for files, terminals, monitoring, codespaces, desktop access, and optional AI-assisted workflows.
</p>

<p align="center">
  <a href="https://github.com/floegence/redeven/releases">Get Desktop</a> |
  <a href="#quick-start">Install CLI</a> |
  <a href="#capability-tour">Explore Capabilities</a> |
  <a href="#what-teams-use-it-for">See Workflows</a> |
  <a href="#docs-by-task">Open Docs</a>
</p>

<p align="center">
  <a href="https://go.dev/"><img alt="Go Version" src="https://img.shields.io/badge/Go-1.25.9-00ADD8?style=flat-square&logo=go"></a>
  <a href="https://nodejs.org/"><img alt="Node Version" src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js"></a>
  <a href="docs/ENV_APP.md"><img alt="Env App" src="https://img.shields.io/badge/Workspace-Env%20App-6C3BFF?style=flat-square"></a>
  <a href="docs/CODE_APP.md"><img alt="Code App" src="https://img.shields.io/badge/IDE-Code%20App-007ACC?style=flat-square"></a>
  <a href="docs/DESKTOP.md"><img alt="Desktop" src="https://img.shields.io/badge/Desktop-Electron-47848F?style=flat-square&logo=electron"></a>
  <a href="docs/AI_AGENT.md"><img alt="AI" src="https://img.shields.io/badge/AI-Flower%20%2B%20Codex-FF4FA3?style=flat-square"></a>
  <a href="https://github.com/floegence/redeven/releases"><img alt="Releases" src="https://img.shields.io/badge/Releases-GitHub-181717?style=flat-square&logo=github"></a>
</p>

Redeven is the runtime that actually lives on the user machine. Open the same environment from the browser, from Redeven Desktop, or from a local URL — while the real files, terminals, processes, and app state stay where they belong: on the endpoint.

**Why it feels different**
- 🔐 Real machine first — you operate the actual endpoint, not a thin illusion of it.
- 🧭 One runtime, many surfaces — Env App, Code App, Desktop Shell, Flower, and Codex all build on the same runtime contract.
- ⚡ Daily work stays fluid — files, terminal, monitoring, ports, notes, and browser IDE flows sit close together instead of splintering into separate tools.
- 📦 Distribution stays auditable — the same project ships as CLI and Desktop through public GitHub Releases with checksums and signatures.

![Redeven architecture overview](docs/images/readme-architecture-overview.jpeg)

## Capability tour

| Surface | What it unlocks | Why people keep using it | Docs |
| --- | --- | --- | --- |
| `Env App` 🗂️ | The main environment workspace | Files, Terminal, Monitoring, Ports, Notes, Git helpers, Runtime Settings, and workbench-style multi-window flows in one place | [`docs/ENV_APP.md`](docs/ENV_APP.md) |
| `Code App` 💻 | Browser-based development | Runs `code-server` through the runtime gateway so IDE access stays attached to the same environment model | [`docs/CODE_APP.md`](docs/CODE_APP.md) |
| `Desktop Shell` 🖥️ | Native launcher and environment manager | Opens local environments, compatible provider environments, saved Redeven Local UI URLs, and SSH Host sessions from one chooser-first shell | [`docs/DESKTOP.md`](docs/DESKTOP.md) |
| `Flower` (optional) 🌸 | AI-assisted work inside Env App | Uses runtime-owned tools for files, terminal work, web search, and structured task execution | [`docs/AI_AGENT.md`](docs/AI_AGENT.md), [`docs/AI_SETTINGS.md`](docs/AI_SETTINGS.md) |
| `Codex` (optional) 🤖 | Separate Codex conversations on top of the same environment | Keeps Codex as its own surface and host-runtime integration rather than folding it into Flower | [`docs/CODEX_UI.md`](docs/CODEX_UI.md) |

## What you can actually do with it

- Open one environment as a real workspace instead of juggling separate file browsers, shells, dashboards, and IDE entry points.
- Browse, preview, and edit text or code files when the environment grants write access.
- Move naturally between Files and Terminal with directory-aware handoffs, and open extra workbench windows only where they genuinely help.
- Watch processes, CPU, memory, and network activity from the same environment surface where you are already working.
- Launch browser-based development through Code App with an explicit, on-demand `code-server` runtime.
- Use Redeven Desktop to manage local environments, compatible control-plane environments, saved Local UI URLs, and SSH hosts.
- Add Flower or Codex when you want AI help without inventing a second permission model.

## What teams use it for

| Use case | Flow | Outcome |
| --- | --- | --- |
| Secure machine access 🔐 | Open Env App, inspect files, attach terminals, and watch monitoring panels | Operate on the real machine without pushing plaintext application traffic through the control plane |
| Browser-based development ⚙️ | Open Codespaces, install or select the managed `code-server` runtime if needed, then switch into Code App | Reach a browser IDE through the runtime gateway |
| Desktop-managed operations 🖥️ | Start Redeven Desktop and choose a local environment, provider environment, saved Redeven Local UI URL, or SSH Host entry | Use one native launcher for both local and remote environment sessions |
| SSH host bootstrap 🚀 | Let Desktop prepare or install the matching Redeven release onto a reachable host over SSH | Bring a host online as a Redeven environment without a manual preinstall |
| AI-assisted operator workflows 🌸 | Enable Flower or use Codex from Env App | Keep AI flows attached to the same runtime context and permission model |

## Quick start

From zero to a live endpoint in a few minutes.

### 1. Install the CLI

```bash
curl -fsSL https://raw.githubusercontent.com/floegence/redeven/main/scripts/install.sh | sh
```

Prefer a native shell? Download Redeven Desktop from [GitHub Releases](https://github.com/floegence/redeven/releases).

Redeven Desktop keeps environment entry simple on purpose: one launcher, one card system, and one place to open local environments, compatible provider environments, saved Redeven Local UI URLs, and SSH hosts.

### 2. Bootstrap once

```bash
redeven bootstrap \
  --controlplane https://<redeven-environment-host> \
  --env-id <env_public_id> \
  --env-token <env_token>
```

Bootstrap writes the control-plane scoped config to `~/.redeven/scopes/controlplane/<provider_key>/<env_public_id>/config.json` by default.

Desktop and browser-assisted flows can also use one-time `bootstrap_ticket` credentials instead of a long-lived `env_token`. The desktop/runtime exchange contract is described in [`docs/DESKTOP.md`](docs/DESKTOP.md).

### 3. Run the endpoint

```bash
redeven run --mode hybrid
```

Expected result:

- `redeven run` starts without config validation errors.
- The endpoint shows online in the control plane.
- Env App can open basic file and terminal actions.

### 4. Pick the runtime shape you need

| Goal | Command |
| --- | --- |
| Local UI only on this machine | `redeven run --mode local` |
| Local UI plus remote control channel | `redeven run --mode hybrid` |
| Desktop-managed runtime | `redeven run --mode desktop --desktop-managed --local-ui-bind localhost:23998` |
| Expose Local UI to another trusted machine | `REDEVEN_LOCAL_UI_PASSWORD=<long-password> redeven run --mode hybrid --local-ui-bind 0.0.0.0:23998 --password-env REDEVEN_LOCAL_UI_PASSWORD` |

## Security, without stealing the spotlight

Redeven leads with capability, but the runtime is still the trust boundary because it owns the real machine.

- The runtime lives on the endpoint and keeps plaintext there.
- The control plane issues bootstrap payloads, grants, and immutable session metadata.
- [Flowersec](https://github.com/floegence/flowersec) carries encrypted bytes between the client and the endpoint runtime.
- Effective permissions come from server-issued session grants, clamped by the local permission policy.
- Local config, E2EE material, audit logs, and diagnostics stay in the endpoint state directory.
- GitHub Releases remain the public source of truth for binaries, checksums, and signatures.

Read the full contract in [`docs/CAPABILITY_PERMISSIONS.md`](docs/CAPABILITY_PERMISSIONS.md), [`docs/PERMISSION_POLICY.md`](docs/PERMISSION_POLICY.md), and [`docs/RELEASE.md`](docs/RELEASE.md).

## Docs by task

| I want to... | Read |
| --- | --- |
| Understand the Env App workspace | [`docs/ENV_APP.md`](docs/ENV_APP.md) |
| Run `code-server` through Redeven | [`docs/CODE_APP.md`](docs/CODE_APP.md) |
| Package, operate, or debug Redeven Desktop | [`docs/DESKTOP.md`](docs/DESKTOP.md) |
| Configure Flower and its settings | [`docs/AI_AGENT.md`](docs/AI_AGENT.md), [`docs/AI_SETTINGS.md`](docs/AI_SETTINGS.md) |
| Understand the optional Codex integration | [`docs/CODEX_UI.md`](docs/CODEX_UI.md) |
| Review permissions and trust boundaries | [`docs/CAPABILITY_PERMISSIONS.md`](docs/CAPABILITY_PERMISSIONS.md), [`docs/PERMISSION_POLICY.md`](docs/PERMISSION_POLICY.md) |
| Integrate a compatible control plane provider | [`redeven-portal` RCPP v1 spec](https://github.com/floegence/redeven-portal/blob/main/docs/protocol/rcpp-v1.md), [`redeven-portal` OpenAPI](https://github.com/floegence/redeven-portal/blob/main/docs/openapi/rcpp-v1.yaml) |
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
- pnpm (or Node.js `corepack`)

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
```

Notes:

- `internal/**/dist/` assets are generated and embedded via Go `embed`.
- Frontend `dist` assets are not checked into git. The tracked exception is `internal/knowledge/dist/*`, which stays committed as verifiable knowledge bundle release metadata.
- `./scripts/lint_ui.sh` validates the Env App and Code App source packages before asset bundling.
- `./scripts/check_desktop.sh` validates the Electron desktop shell package.
- `./scripts/dev_desktop.sh` stops any existing Redeven Desktop/runtime processes, then starts Desktop from the current checkout or worktree with a freshly bundled runtime.
- `cd desktop && npm run start` and `cd desktop && npm run package` prepare `desktop/.bundle/<goos>-<goarch>/redeven` from the current repository before Electron starts or packages the desktop shell.

</details>

<details>
<summary>Local state, release paths, and troubleshooting</summary>

### Common local files

- `~/.redeven/scopes/local/default/config.json`
- `~/.redeven/scopes/local/default/secrets.json`
- `~/.redeven/scopes/local/default/agent.lock`
- `~/.redeven/scopes/local/default/audit/events.jsonl`
- `~/.redeven/scopes/local/default/diagnostics/agent-events.jsonl`
- `~/.redeven/scopes/local/default/diagnostics/desktop-events.jsonl`
- `~/.redeven/scopes/local/default/apps/code/...`

Derived control-plane scopes use isolated state per environment:

- `~/.redeven/scopes/controlplane/<provider_key>/<env_public_id>/config.json`

Desktop and standalone runtime mode also share one environment catalog under:

- `~/.redeven/catalog/environments/*.json`
- `~/.redeven/catalog/connections/*.json`
- `~/.redeven/catalog/providers/*.json`

### Public release contract

- GitHub Release is the source of truth for versioned CLI tarballs, desktop installers, checksums, and signatures.
- `scripts/install.sh` resolves versions from GitHub Releases and downloads release assets directly from GitHub.
- The public installer endpoint used by runtime self-upgrade is documented in [`docs/RELEASE.md`](docs/RELEASE.md).

### Common troubleshooting entry points

- `bootstrap failed` or `missing direct connect info`: verify `--controlplane`, `--env-id`, and your bootstrap credential.
- `code-server runtime missing or unusable`: open Env App -> Runtime Settings -> `code-server Runtime`, then install or select a runtime.
- `Missing init payload` in Codespaces: reopen the codespace so a new entry ticket can be minted.
- Desktop lock conflict: stop the other runtime instance that owns `~/.redeven`, or restart it in a Local UI mode, then retry.
- Requests feel slow: open Runtime Settings -> Debug Console and compare desktop, gateway, and UI timing.

</details>

## Open-source scope

This public repository covers the endpoint/runtime layer, Redeven Local UI behavior, the desktop shell, and the GitHub Release contract.

Organization-specific deployment automation, control-plane implementations, and environment-specific wrappers are intentionally out of scope here.
