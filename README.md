<p align="center">
  <img src="desktop/build/icon.svg" alt="Redeven" width="120">
</p>

# Redeven

<p align="center">
  <strong>Secure the real machine, not just the browser tab.</strong><br>
  Turn any machine into a secure workspace for files, terminals, monitoring, ports, browser development, desktop access, and optional AI-assisted work.
</p>

<p align="center">
  <a href="https://github.com/floegence/redeven/releases">Get Desktop</a> |
  <a href="#quick-start">Install CLI</a> |
  <a href="#what-redeven-lets-you-do">See what it does</a> |
  <a href="#common-workflows">Common workflows</a> |
  <a href="#docs-by-task">Docs</a>
</p>

<p align="center">
  <a href="https://go.dev/"><img alt="Go Version" src="https://img.shields.io/badge/Go-1.25.9-00ADD8?style=flat-square&logo=go"></a>
  <a href="https://nodejs.org/"><img alt="Node Version" src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js"></a>
  <a href="docs/ENV_APP.md"><img alt="Machine Workspace" src="https://img.shields.io/badge/Machine-Workspace-6C3BFF?style=flat-square"></a>
  <a href="docs/CODE_APP.md"><img alt="Browser IDE" src="https://img.shields.io/badge/Browser-IDE-007ACC?style=flat-square"></a>
  <a href="docs/DESKTOP.md"><img alt="Desktop App" src="https://img.shields.io/badge/Desktop-App-47848F?style=flat-square&logo=electron"></a>
  <a href="docs/AI_AGENT.md"><img alt="AI Assistance" src="https://img.shields.io/badge/AI-Assistance-FF4FA3?style=flat-square"></a>
  <a href="https://github.com/floegence/redeven/releases"><img alt="Releases" src="https://img.shields.io/badge/Releases-GitHub-181717?style=flat-square&logo=github"></a>
</p>

Redeven runs on the machine you want to operate. Open that machine from the browser, from Redeven Desktop, or from a local URL while the real files, terminals, processes, services, and app state stay where they belong: on that machine.

**Why it feels different**
- 🔐 Real machine first — you operate the actual machine, not a thin illusion of it.
- 🧭 One place to work — files, terminal, monitoring, ports, notes, and browser development sit together instead of splintering across separate tools.
- ⚡ Fast entry from browser or desktop — choose the machine, open the workspace, and start with the context already nearby.
- 📦 Distribution stays auditable — the same project ships as CLI and Desktop through public GitHub Releases with checksums and signatures.

![Redeven architecture overview](docs/images/readme-architecture-overview.jpeg)

## What Redeven lets you do

Redeven gives you a secure workspace for a real machine. Open it from the browser or desktop, then inspect files, run commands, watch processes, reach services, start a browser IDE, and bring AI into the task without leaving the machine context.

| When you need to... | Redeven lets you... | Why it helps | Details |
| --- | --- | --- | --- |
| Open a machine from anywhere | Choose a local machine, a provider-managed machine, a saved local URL, or a reachable SSH host | You stop juggling SSH tabs, copied tokens, temporary tunnels, and scattered dashboards | [`Workspace`](docs/ENV_APP.md), [`Desktop`](docs/DESKTOP.md) |
| Understand what is happening | Browse files, inspect logs, open terminals, watch CPU, memory, network, and processes, and keep notes beside the work | Investigation starts from the machine itself instead of from disconnected tools | [`Workspace`](docs/ENV_APP.md) |
| Fix something quickly | Edit granted files, open a terminal in the folder you are viewing, run commands, and keep nearby context visible | Small fixes do not require switching between a file browser, a shell, a monitor, and a notes app | [`Workspace`](docs/ENV_APP.md) |
| Develop in the browser | Start a full browser IDE for the same machine only when you need deeper coding tools | You get browser-based development without making the browser the place where the machine state lives | [`Browser IDE`](docs/CODE_APP.md) |
| Reach a running service | Open ports and app previews through Redeven-managed access | You can inspect a service without hand-wiring tunnels or sharing random local URLs | [`Workspace`](docs/ENV_APP.md), [`Browser IDE`](docs/CODE_APP.md) |
| Bring an SSH host online | Let the desktop app prepare a reachable host and install the matching Redeven release | An existing machine can become a managed workspace without a manual preinstall ritual | [`Desktop`](docs/DESKTOP.md) |
| Add AI help to machine work | Let optional AI assistance read files, run commands, search, and help complete tasks under the same access rules | AI joins the real workspace instead of becoming a separate, overpowered side channel | [`AI`](docs/AI_AGENT.md), [`Settings`](docs/AI_SETTINGS.md), [`Codex`](docs/CODEX_UI.md) |

## A typical session

1. Choose a machine from the browser or desktop.
2. Check files, logs, resource usage, and running processes.
3. Open a terminal exactly where the problem is.
4. Start a browser IDE only when you need deeper code editing.
5. Open ports or app previews from the same workspace.
6. Ask AI for help when the task benefits from it.

## Common workflows

| Use case | Flow | Outcome |
| --- | --- | --- |
| Secure machine access 🔐 | Open a workspace, inspect files, attach terminals, and watch monitoring panels | Operate on the real machine without pushing plaintext application traffic through the control plane |
| Browser-based development ⚙️ | Start the browser IDE, install or select the managed `code-server` runtime if needed, and keep terminals, files, and ports nearby | Reach a full coding workspace through the same machine access path |
| Desktop-managed operations 🖥️ | Start Redeven Desktop and choose a local machine, provider-managed machine, saved local URL, or SSH host | Use one native launcher for local and remote sessions |
| SSH host bootstrap 🚀 | Let Desktop prepare or install the matching Redeven release onto a reachable host over SSH | Bring a host online as a Redeven workspace without a manual preinstall |
| AI-assisted operations 🌸 | Enable optional AI assistance for file, terminal, search, and task work | Keep AI help attached to the same machine context and permission model |

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
  --bootstrap-ticket <bootstrap_ticket>
```

Bootstrap writes the machine config to `~/.redeven/machine/config.json` by default. A machine is bound to one environment for the signed-in user at a time; running bootstrap again with a fresh one-time ticket rebinds that machine.

Desktop and browser-assisted flows use the same one-time `bootstrap_ticket` contract. The desktop/runtime exchange contract is described in [`docs/DESKTOP.md`](docs/DESKTOP.md).

### 3. Run the endpoint

```bash
redeven run --mode hybrid
```

Expected result:

- `redeven run` starts without config validation errors.
- The endpoint shows online in the control plane.
- The browser workspace can open basic file and terminal actions.

### 4. Pick how this machine should run

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
| Work with files, terminals, monitoring, notes, ports, and settings | [`docs/ENV_APP.md`](docs/ENV_APP.md) |
| Run a browser IDE through Redeven | [`docs/CODE_APP.md`](docs/CODE_APP.md) |
| Package, operate, or debug Redeven Desktop | [`docs/DESKTOP.md`](docs/DESKTOP.md) |
| Configure optional AI assistance | [`docs/AI_AGENT.md`](docs/AI_AGENT.md), [`docs/AI_SETTINGS.md`](docs/AI_SETTINGS.md) |
| Connect Codex to the same machine workspace | [`docs/CODEX_UI.md`](docs/CODEX_UI.md) |
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
- `./scripts/lint_ui.sh` validates the machine workspace and browser IDE source packages before asset bundling.
- `./scripts/check_desktop.sh` validates the Electron desktop shell package.
- `./scripts/dev_desktop.sh` stops any existing Redeven Desktop process, then starts Desktop from the current checkout or worktree with a freshly bundled runtime. It leaves existing runtime processes running unless you explicitly pass `--stop-runtimes`. For SSH Host bootstrap, it exports `REDEVEN_DESKTOP_SSH_RUNTIME_RELEASE_TAG` from the development bundle version unless you set that variable explicitly.
- `cd desktop && npm run start` and `cd desktop && npm run package` prepare `desktop/.bundle/<goos>-<goarch>/redeven` from the current repository before Electron starts or packages the desktop shell.

</details>

<details>
<summary>Local state, release paths, and troubleshooting</summary>

### Common local files

- `~/.redeven/machine/config.json`
- `~/.redeven/machine/secrets.json`
- `~/.redeven/machine/agent.lock`
- `~/.redeven/machine/audit/events.jsonl`
- `~/.redeven/machine/diagnostics/agent-events.jsonl`
- `~/.redeven/machine/diagnostics/desktop-events.jsonl`
- `~/.redeven/machine/apps/code/...`

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
- `code-server runtime missing or unusable`: open workspace settings -> `code-server Runtime`, then install or select a runtime.
- `Missing init payload` in the browser IDE: reopen the browser IDE so a new entry ticket can be minted.
- Desktop lock conflict: stop the other runtime instance that owns `~/.redeven`, or restart it in a Local UI mode, then retry.
- Requests feel slow: open Runtime Settings -> Debug Console and compare desktop, gateway, and UI timing.

</details>

## Open-source scope

This public repository covers the endpoint/runtime layer, Redeven Local UI behavior, the desktop shell, and the GitHub Release contract.

Organization-specific deployment automation, control-plane implementations, and environment-specific wrappers are intentionally out of scope here.
