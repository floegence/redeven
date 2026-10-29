<p align="center">
  <img src="assets/brand/redeven/png/app-icon-256.png" alt="Redeven" width="72">
</p>

# Redeven

**Where machines become workspaces.**

Your computers and servers, brought together with files, terminals, Git, and AI. Work in a browser. Keep your projects on your machines.

**[Website](https://redeven.com)** · **[Try the demo](https://redeven.com/#product)** · [Get Desktop](https://redeven.com/download) · [Docs](https://redeven.com/docs)

![Redeven Workbench running with real files, a terminal, notes, and system monitoring](assets/readme/runtime-workbench.webp)

<!-- readme-section:work -->
<a id="work"></a>

## Everything your next idea needs

- **Make room for your workflow.** Arrange files, terminals, notes, and monitoring on Workbench.
- **Move from idea to working code.** Browse changes, open your editor, and bring up web services on the same machine.
- **Work with Flower.** An AI assistant that can use your environment's tools with your permission.

![Redeven file browser previewing the project source on a running Runtime](assets/readme/runtime-files.webp)

Captured from a running Redeven instance in Chrome, using the project’s source files and a real terminal session.

<!-- readme-section:start -->
<a id="start"></a>

## Start where you work

![Desktop combines an Environment Center and local Runtime; Web Center runs independently on your server; each target machine keeps its own Runtime](assets/readme/ways-to-connect.svg)

- **[Desktop](https://redeven.com/docs/download-desktop)** — the easiest starting point on macOS and Linux, with a bundled local Runtime and guided remote connections.
- **[Runtime](https://redeven.com/docs/download-runtime)** — run directly on a computer or server and open its workspace in your browser.
- **[Web Center](https://redeven.com/docs/environment-center)** — host a private environment directory for one administrator. Open approved Runtimes from a browser without Desktop. See the guide for package availability and setup.

Prefer shared, account-based access? Explore [Redeven Cloud](https://redeven.com/docs/control-plane-providers).

Files and processes stay on the target machine. Flowersec protects remote sessions; Web Center is a trusted proxy that can see application traffic. [Understand the security model](https://redeven.com/docs/security-architecture).

<!-- readme-section:documentation -->
<a id="documentation"></a>

## Go further

[Getting started](https://redeven.com/docs/getting-started) · [Deployment guide](okf/operations/web-center-deployment.md) · [Releases](https://github.com/floegence/redeven/releases) · [Source knowledge · OKF v0.2](okf/index.md)

<details>
<summary>Build from source</summary>

Go `1.27.3` · Node.js `26.7.0` · npm / pnpm

[![Go](https://img.shields.io/badge/Go-1.27.3-00ADD8?style=flat-square&logo=go)](https://go.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-26.7.0-339933?style=flat-square&logo=node.js)](https://nodejs.org/)

```bash
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

See the [repository guide](AGENTS.md) for development and validation requirements.

</details>

<!-- readme-section:license -->
<a id="license"></a>

## Open source

[MIT licensed](LICENSE). Runtime, Desktop, and Web Center live here. [Third-party notices](THIRD_PARTY_NOTICES.md).

<!-- readme-locales:start -->
<p align="center">
  <strong>English</strong> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.zh-TW.md">繁體中文</a> |
  <a href="README.ja-JP.md">日本語</a> |
  <a href="README.ko-KR.md">한국어</a> |
  <a href="README.de-DE.md">Deutsch</a> |
  <a href="README.fr-FR.md">Français</a> |
  <a href="README.es-ES.md">Español</a> |
  <a href="README.pt-BR.md">Português do Brasil</a> |
  <a href="README.ru-RU.md">Русский</a>
</p>
<!-- readme-locales:end -->
