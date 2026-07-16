<p align="center">
  <img src="assets/brand/redeven/png/app-icon-256.png" alt="Redeven" width="120">
</p>

# Redeven

<!-- readme-locales:start -->
<p align="center">
  <a href="README.md">English</a> |
  <strong>简体中文</strong> |
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

<p align="center">
  <strong>您的电脑与服务器，尽在一个浏览器标签页。</strong><br>
  终端、文件浏览器、IDE 与 AI，
  <br>全部运行在您自己的硬件上，并提供端到端加密。
</p>

<p align="center">
  <a href="https://github.com/floegence/redeven/releases">下载 Desktop</a> |
  <a href="#quick-start">安装 CLI</a> |
  <a href="#what-you-can-do">功能</a> |
  <a href="#security">安全</a> |
  <a href="#documentation">文档</a>
</p>

<p align="center">
  <a href="https://go.dev/"><img alt="Go 版本" src="https://img.shields.io/badge/Go-1.26.3-00ADD8?style=flat-square&logo=go"></a>
  <a href="https://nodejs.org/"><img alt="Node.js 版本" src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js"></a>
  <a href="okf/index.md"><img alt="OKF 知识库" src="https://img.shields.io/badge/Knowledge-OKF%20v0.1-6C3BFF?style=flat-square"></a>
  <a href="https://github.com/floegence/redeven/releases"><img alt="发行版本" src="https://img.shields.io/badge/Releases-GitHub-181717?style=flat-square&logo=github"></a>
</p>

<!-- readme-section:what-is-redeven -->
<a id="what-is-redeven"></a>

## 什么是 Redeven？

Redeven 是一个单文件二进制程序，可将您的电脑和服务器汇集到一个浏览器标签页中。无需在 SSH 终端、文件浏览器、监控面板、端口转发和 IDE 窗口之间来回切换，您可以直接在自己掌控的硬件上使用统一工作区。

它可以运行在您的本机、远程服务器或任何可访问的 SSH 主机上。文件、进程、API 密钥和凭据始终留在它们应在的位置；Redeven 不会通过任何第三方基础设施传输您的明文数据。

- **客户端连接到端点运行时**：浏览器、Desktop、CLI 和基于 SSH 主机的会话都会进入由同一运行时管理的工作区。
- **运行时是信任边界**：一个 Go 二进制程序统一负责文件、终端、监控、Git、Web 服务转发、Workbench 布局、笔记、Browser Editor 设置、Flower 和 Codex 桥接访问。
- **传输与策略始终明确**：Flowersec 承载加密的 RPC 与流式通信流量；会话授权、本地权限策略、文件系统范围和本地机密信息共同限制每个会话可执行的操作。

![Redeven 架构概览](assets/readme/architecture-overview.png)

<!-- readme-section:quick-start -->
<a id="quick-start"></a>

## 快速开始

您可以通过两种方式开始使用：Desktop（推荐大多数用户使用）或 CLI。

<!-- readme-section:desktop-app -->
<a id="desktop-app"></a>

### Desktop 应用

1. 从 [GitHub Releases](https://github.com/floegence/redeven/releases) 下载 Redeven Desktop。
2. 打开应用并选择环境：本地、Provider、SSH 主机或已保存的 URL。
3. 开始工作，工作区会自动在浏览器中打开。

对于远程计算机：Desktop 可以通过 SSH 自动安装匹配的 Redeven 版本，并在您选择后，将该托管 SSH 运行时明确连接到 provider 环境。无需在远程主机上手动设置。

<!-- readme-section:cli -->
<a id="cli"></a>

### CLI

```bash
# 1. 安装
curl -fsSL https://raw.githubusercontent.com/floegence/redeven/main/scripts/install.sh | sh

# 2. 运行
redeven run

# 3. 在浏览器中打开 http://localhost:23998。
```

首次执行 `redeven run` 会初始化 `~/.redeven/local-environment/` 下的本地状态，并以本地模式启动。无需进行引导初始化或控制平面配置。Local UI 仅监听 `localhost:23998`，只能从当前设备访问；不支持从局域网或公网直接访问。按 Ctrl+C 可停止运行时。

如需了解其他运行模式或可选的本地密码保护，请运行 `redeven help run`。

<!-- readme-section:what-you-can-do -->
<a id="what-you-can-do"></a>

## 您可以完成什么

| 功能界面 | 提供的能力 |
|---|---|
| 文件与 Git | 文件上传和下载、内联预览和编辑、限定目录范围的 Git 变更、差异比较及 stash 工作流。 |
| 终端 | 以当前工作目录为根目录的多标签终端，并遵循相同的运行时权限模型。 |
| 监控 | 来自端点运行时的 CPU、内存、磁盘、网络和进程视图。 |
| Browser Editor | 由 Desktop 明确设置、按工作区隔离的浏览器编辑器会话。 |
| Web 服务 | 由运行时管理的服务注册和端口转发访问，无需手写 SSH 隧道。 |
| Flower 与 Codex | 可选的 AI 界面，使用经运行时验证的工具及本地模型和主机配置。 |
| Desktop | 用于本地环境、provider 托管环境、通过 SSH 引导的环境和已保存 Local UI 环境的原生启动器。 |

<!-- readme-section:security -->
<a id="security"></a>

## 安全，但不喧宾夺主

Redeven 以能力为先，但运行时仍然是信任边界，因为它实际掌控主机。

- 运行时位于端点，明文数据始终保留在端点。
- 控制平面签发引导载荷、授权和不可变的会话元数据。
- [Flowersec](https://github.com/floegence/flowersec) 在客户端与端点运行时之间传输加密字节；当前运行时集成以 `flowersec-go/v0.20.2` 为准。
- 有效权限来自服务器签发的会话授权，并受本地权限策略约束（`read`、`write`、`execute`、`admin`，任何类别都不会隐含其他类别）。
- 本地配置、E2EE 材料、审计日志和诊断数据保留在端点状态目录中。
- GitHub Releases 始终是二进制文件、校验和、签名及 OKF 验证资产的公开权威来源。

<!-- readme-section:documentation -->
<a id="documentation"></a>

## 文档

Redeven 在 [OKF v0.1](okf/index.md) 中维护仓库知识。OKF 语料由当前源代码层面的行为生成，并嵌入运行时供 `okf.search` 使用。

机器可读的 provider 集成接口位于 [spec/openapi/rcpp-v2.yaml](spec/openapi/rcpp-v2.yaml)。在 OKF 之外，维护中的 Markdown 被明确限制为 `AGENTS.md`、`THIRD_PARTY_NOTICES.md`、权威英文 `README.md`，以及在 `assets/readme/locales.json` 中声明的受支持 `README.<locale>.md` 翻译。

<!-- readme-section:for-developers -->
<a id="for-developers"></a>

## 面向开发者

从源代码构建、检查并验证项目。

<details>
<summary>从源代码构建</summary>

<!-- readme-section:prerequisites -->
<a id="prerequisites"></a>

### 前置条件

- Go `1.26.3`
- Node.js `24`
- npm
- pnpm 或 Node.js `corepack`

<!-- readme-section:build -->
<a id="build"></a>

### 构建

```bash
./scripts/lint_ui.sh
./scripts/check_desktop.sh
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

<!-- readme-section:local-guardrails -->
<a id="local-guardrails"></a>

### 本地保护措施

```bash
./scripts/install_git_hooks.sh
node scripts/generate_third_party_notices.mjs --check
```

说明：

- `internal/**/dist/` 资产由构建生成，并通过 Go `embed` 嵌入。
- 前端 `dist` 资产不会提交到 Git。受跟踪的例外是 `okf/dist/*`，它作为可验证的 OKF bundle 发行元数据保持提交状态。
- `THIRD_PARTY_NOTICES.md` 由 Go 模块和 JavaScript 锁文件生成。依赖变更后运行 `node scripts/generate_third_party_notices.mjs`，并确保 `--check` 始终通过。
- `./scripts/lint_ui.sh`、`./scripts/check_desktop.sh`、`./scripts/build_assets.sh` 和 `go test ./...` 是主要的源代码级检查。
- `./scripts/dev_desktop.sh` 使用新打包的运行时，从当前检出目录或 worktree 启动 Desktop。
- `cd desktop && npm run start` 和 `cd desktop && npm run package` 会在 Electron 启动或打包 Desktop shell 之前，准备 `desktop/.bundle/<goos>-<goarch>/redeven`。

</details>

<details>
<summary>本地状态、发行路径与故障排除</summary>

- 本地环境状态默认位于 `~/.redeven/local-environment/`；Desktop 和独立运行时模式还会共享 `~/.redeven/catalog/` 下的配置目录。
- GitHub Releases 是带版本 CLI 压缩包、Desktop 安装程序、校验和、签名及 OKF 验证资产的公开权威来源。
- 如需了解当前实现详情，请使用 `okf.search` 查询嵌入式 OKF bundle，或查看 [okf/index.md](okf/index.md)。

</details>

<!-- readme-section:license -->
<a id="license"></a>

## 许可证

Redeven 采用 [MIT License](LICENSE)。第三方依赖声明记录在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中；发行归档和 Desktop 软件包会在运行时产物旁包含这些文件。

<!-- readme-section:open-source-scope -->
<a id="open-source-scope"></a>

## 开源范围

此公开仓库涵盖端点和运行时层、Redeven Local UI 行为、Desktop shell 以及 GitHub Release 契约。

特定组织的部署自动化、控制平面实现和站点专用打包封装明确不在此仓库范围内。
