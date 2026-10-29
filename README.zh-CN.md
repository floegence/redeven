<p align="center">
  <img src="assets/brand/redeven/png/app-icon-256.png" alt="Redeven" width="72">
</p>

# Redeven

**Where machines become workspaces.**

将电脑与服务器上的文件、终端、Git 和 AI 汇聚一处。在浏览器里工作，项目始终留在自己的设备上。

**[官网](https://redeven.com)** · **[体验 Demo](https://redeven.com/#product)** · [下载 Desktop](https://redeven.com/download) · [文档](https://redeven.com/docs)

![实际运行的 Redeven Workbench：文件、终端、笔记和系统监控](assets/readme/runtime-workbench.webp)

<!-- readme-section:work -->
<a id="work"></a>

## 让下一个想法，有处落地

- **按自己的节奏工作。** 在 Workbench 上自由编排文件、终端、笔记和监控。
- **从想法走向可运行的代码。** 查看代码变更、打开编辑器，在同一台设备上启动网页服务。
- **与 Flower 一起推进。** 在你的授权下，AI 助手可以使用环境中的工具完成工作。

![实际运行的 Redeven 文件浏览器，正在预览项目源码](assets/readme/runtime-files.webp)

截图来自 Chrome 中实际运行的 Redeven，展示项目源码和真实终端会话。

<!-- readme-section:start -->
<a id="start"></a>

## 选择适合你的入口

![Desktop 包含环境中心和本地运行时；Web Center 独立部署在服务器上；每台目标设备保留自己的运行时](assets/readme/ways-to-connect.svg)

- **[Desktop](https://redeven.com/docs/download-desktop)** — macOS 与 Linux 上最便捷的起点，内置本地运行时，并引导你连接远程设备。
- **[运行时](https://redeven.com/docs/download-runtime)** — 直接运行在电脑或服务器上，通过浏览器打开工作区。
- **[Web Center](https://redeven.com/docs/environment-center)** — 为一位管理员部署私有环境目录，无需 Desktop 即可在浏览器中打开已授权的运行时。安装包供应与部署步骤见指南。

需要基于账号的共享访问？了解 [Redeven Cloud](https://redeven.com/docs/control-plane-providers)。

文件和进程始终位于目标设备。Flowersec 保护远程会话；Web Center 是可信代理，可以看到应用流量。 [了解安全模型](https://redeven.com/docs/security-architecture)。

<!-- readme-section:documentation -->
<a id="documentation"></a>

## 继续探索

[入门指南](https://redeven.com/docs/getting-started) · [部署指南](okf/operations/web-center-deployment.md) · [版本发布](https://github.com/floegence/redeven/releases) · [源码知识库 · OKF v0.2](okf/index.md)

<details>
<summary>从源码构建</summary>

Go `1.27.3` · Node.js `26.7.0` · npm / pnpm

[![Go](https://img.shields.io/badge/Go-1.27.3-00ADD8?style=flat-square&logo=go)](https://go.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-26.7.0-339933?style=flat-square&logo=node.js)](https://nodejs.org/)

```bash
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

开发与验证要求见 [仓库指南](AGENTS.md)。

</details>

<!-- readme-section:license -->
<a id="license"></a>

## 开源

[MIT 许可证](LICENSE)。运行时、Desktop 和 Web Center 的源码均在此仓库。 [第三方声明](THIRD_PARTY_NOTICES.md)。

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
