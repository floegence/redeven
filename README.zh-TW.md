<p align="center">
  <img src="assets/brand/redeven/png/app-icon-256.png" alt="Redeven" width="72">
</p>

# Redeven

**Where machines become workspaces.**

將電腦與伺服器上的檔案、終端機、Git 和 AI 整合於一處。在瀏覽器中工作，專案始終留在自己的裝置上。

**[官網](https://redeven.com)** · **[體驗 Demo](https://redeven.com/#product)** · [下載 Desktop](https://redeven.com/download) · [文件](https://redeven.com/docs)

![實際執行的 Redeven Workbench：檔案、終端機、筆記和系統監控](assets/readme/runtime-workbench.webp)

<!-- readme-section:work -->
<a id="work"></a>

## 讓下一個想法，有處落實

- **依照自己的步調工作。** 在 Workbench 上自由安排檔案、終端機、筆記和監控。
- **從想法走向可執行的程式。** 檢視程式變更、開啟編輯器，在同一部裝置上啟動網頁服務。
- **與 Flower 一起推進。** 在你的授權下，AI 助理可以使用環境中的工具完成工作。

![實際執行的 Redeven 檔案瀏覽器，正在預覽專案原始碼](assets/readme/runtime-files.webp)

截圖取自 Chrome 中實際執行的 Redeven，呈現專案原始碼和真實終端機工作階段。

<!-- readme-section:start -->
<a id="start"></a>

## 選擇適合你的入口

![Desktop 包含環境中心與本機執行環境；Web Center 獨立部署於伺服器；每部目標裝置保留自己的執行環境](assets/readme/ways-to-connect.svg)

- **[Desktop](https://redeven.com/docs/download-desktop)** — macOS 與 Linux 上最方便的起點，內建本機執行環境，並引導你連接遠端裝置。
- **[執行環境](https://redeven.com/docs/download-runtime)** — 直接在電腦或伺服器上執行，透過瀏覽器開啟工作區。
- **[Web Center](https://redeven.com/docs/environment-center)** — 為一位管理員部署私人環境目錄，無需 Desktop 即可在瀏覽器中開啟已授權的執行環境。安裝套件供應與部署步驟請見指南。

需要以帳號為基礎的共用存取？認識 [Redeven Cloud](https://redeven.com/docs/control-plane-providers)。

檔案和程序始終位於目標裝置。Flowersec 保護遠端工作階段；Web Center 是受信任的代理，可看見應用程式流量。 [瞭解安全模型](https://redeven.com/docs/security-architecture)。

<!-- readme-section:documentation -->
<a id="documentation"></a>

## 繼續探索

[入門指南](https://redeven.com/docs/getting-started) · [部署指南](okf/operations/web-center-deployment.md) · [版本發行](https://github.com/floegence/redeven/releases) · [原始碼知識庫 · OKF v0.2](okf/index.md)

<details>
<summary>從原始碼建置</summary>

Go `1.27.3` · Node.js `26.7.0` · npm / pnpm

[![Go](https://img.shields.io/badge/Go-1.27.3-00ADD8?style=flat-square&logo=go)](https://go.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-26.7.0-339933?style=flat-square&logo=node.js)](https://nodejs.org/)

```bash
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

開發與驗證規範請參閱 [儲存庫指南](AGENTS.md)。

</details>

<!-- readme-section:license -->
<a id="license"></a>

## 開放原始碼

[MIT 授權條款](LICENSE)。執行環境、Desktop 與 Web Center 的原始碼均位於此儲存庫。 [第三方聲明](THIRD_PARTY_NOTICES.md)。

<!-- readme-locales:start -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <strong>繁體中文</strong> |
  <a href="README.ja-JP.md">日本語</a> |
  <a href="README.ko-KR.md">한국어</a> |
  <a href="README.de-DE.md">Deutsch</a> |
  <a href="README.fr-FR.md">Français</a> |
  <a href="README.es-ES.md">Español</a> |
  <a href="README.pt-BR.md">Português do Brasil</a> |
  <a href="README.ru-RU.md">Русский</a>
</p>
<!-- readme-locales:end -->
