<p align="center">
  <img src="assets/brand/redeven/png/app-icon-256.png" alt="Redeven" width="120">
</p>

# Redeven

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

<p align="center">
  <strong>您的電腦與伺服器，盡在一個瀏覽器分頁。</strong><br>
  終端機、檔案瀏覽器、IDE 與 AI，
  <br>全都在您自己的硬體上執行，並提供端對端加密。
</p>

<p align="center">
  <a href="https://github.com/floegence/redeven/releases">下載 Desktop</a> |
  <a href="#quick-start">安裝 CLI</a> |
  <a href="#what-you-can-do">功能</a> |
  <a href="#security">安全性</a> |
  <a href="#documentation">文件</a>
</p>

<p align="center">
  <a href="https://go.dev/"><img alt="Go 版本" src="https://img.shields.io/badge/Go-1.26.3-00ADD8?style=flat-square&logo=go"></a>
  <a href="https://nodejs.org/"><img alt="Node.js 版本" src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js"></a>
  <a href="okf/index.md"><img alt="OKF 知識庫" src="https://img.shields.io/badge/Knowledge-OKF%20v0.1-6C3BFF?style=flat-square"></a>
  <a href="https://github.com/floegence/redeven/releases"><img alt="發行版本" src="https://img.shields.io/badge/Releases-GitHub-181717?style=flat-square&logo=github"></a>
</p>

<p align="center">
  <img src="assets/readme/redeven-demo.gif" alt="Redeven 示範：在單一瀏覽器分頁中使用檔案、終端、Git、Workbench 與 Code Server" width="100%">
</p>

<!-- readme-section:what-is-redeven -->
<a id="what-is-redeven"></a>

## 什麼是 Redeven？

Redeven 是單一二進位檔，可將您的電腦與伺服器集中到一個瀏覽器分頁。您不必在 SSH 終端機、檔案瀏覽器、監控儀表板、連接埠轉送與 IDE 視窗之間來回切換，而能直接在自己掌控的硬體上使用統一工作區。

它可以在您的電腦、遠端伺服器或任何可連線的 SSH 主機上執行。檔案、處理程序、API 金鑰與認證資料都留在原本的位置；Redeven 不會透過任何第三方基礎設施傳送您的明文資料。

- **用戶端連線到端點執行階段**：瀏覽器、Desktop、CLI 與透過 SSH 主機建立的工作階段，都會進入由同一執行階段管理的工作區。
- **執行階段是信任邊界**：單一 Go 二進位檔統一負責檔案、終端機、監控、Git、Web 服務轉送、Workbench 版面配置、筆記、Browser Editor 設定、Flower 與 Codex 橋接存取。
- **傳輸與原則保持明確**：Flowersec 承載加密 RPC 與串流流量；工作階段授權、本機權限原則、檔案系統範圍與本機機密資料共同限制各工作階段可執行的操作。

![Redeven 架構概覽](assets/readme/architecture-overview.png)

<!-- readme-section:quick-start -->
<a id="quick-start"></a>

## 快速開始

您可以透過兩種方式開始使用：Desktop（建議大多數使用者使用）或 CLI。

<!-- readme-section:desktop-app -->
<a id="desktop-app"></a>

### Desktop 應用程式

1. 從 [GitHub Releases](https://github.com/floegence/redeven/releases) 下載 Redeven Desktop。
2. 開啟應用程式並選擇環境：本機、Provider、SSH 主機或已儲存的 URL。
3. 開始工作，工作區會自動在瀏覽器中開啟。

對於遠端電腦：Desktop 可以透過 SSH 自動安裝相符的 Redeven 版本，並在您選擇後，將該受管理的 SSH 執行階段明確連線至 provider 環境。遠端主機不需要手動設定。

<!-- readme-section:cli -->
<a id="cli"></a>

### CLI

```bash
# 1. 安裝
curl -fsSL https://raw.githubusercontent.com/floegence/redeven/main/scripts/install.sh | sh

# 2. 執行
redeven run

# 3. 在瀏覽器中開啟 http://localhost:23998。
```

首次執行 `redeven run` 會初始化 `~/.redeven/local-environment/` 下的本機狀態，並以本機模式啟動。無需進行引導初始化或控制平面設定。Local UI 僅監聽 `localhost:23998`，只能從目前的裝置存取；不支援從區域網路或公用網路直接存取。按 Ctrl+C 可停止執行階段。

如需瞭解其他執行模式或選用的本機密碼保護，請執行 `redeven help run`。

<!-- readme-section:what-you-can-do -->
<a id="what-you-can-do"></a>

## 您可以完成的工作

| 功能介面 | 提供的能力 |
|---|---|
| 檔案與 Git | 檔案上傳與下載、內嵌預覽與編輯、限定資料夾範圍的 Git 變更、差異比較及 stash 工作流程。 |
| 終端機 | 以目前工作目錄為根目錄的多分頁終端機，並遵循相同的執行階段權限模型。 |
| 監控 | 來自端點執行階段的 CPU、記憶體、磁碟、網路與處理程序檢視。 |
| Browser Editor | 由 Desktop 明確設定、依工作區隔離的瀏覽器編輯器工作階段。 |
| Web 服務 | 由執行階段管理的服務註冊與連接埠轉送存取，不必手動編寫 SSH 通道。 |
| Flower 與 Codex | 選用的 AI 介面，使用經執行階段驗證的工具及本機模型和主機設定。 |
| Desktop | 用於本機環境、provider 託管環境、透過 SSH 引導初始化的環境及已儲存 Local UI 環境的原生啟動器。 |

<!-- readme-section:security -->
<a id="security"></a>

## 安全性，不喧賓奪主

Redeven 以能力為核心，但執行階段仍是信任邊界，因為它實際掌控主機。

- 執行階段位於端點，明文資料始終保留在端點。
- 控制平面簽發引導初始化資料、授權及不可變的工作階段中繼資料。
- [Flowersec](https://github.com/floegence/flowersec) 在用戶端與端點執行階段之間傳輸加密位元組；目前執行階段整合以 `flowersec-go/v0.27.0` 為準。
- 有效權限來自伺服器簽發的工作階段授權，並受本機權限原則限制（`read`、`write`、`execute`、`admin`，任何類別都不隱含其他類別）。
- 本機設定、E2EE 資料、稽核記錄與診斷資料都保留在端點狀態目錄。
- GitHub Releases 始終是二進位檔、總和檢查碼、簽章及 OKF 驗證資產的公開權威來源。

<!-- readme-section:documentation -->
<a id="documentation"></a>

## 文件

Redeven 在 [OKF v0.1](okf/index.md) 中維護儲存庫知識。OKF 語料由目前原始碼層級的行為產生，並嵌入執行階段供 `okf.search` 使用。

機器可讀的 provider 整合介面位於 [spec/openapi/rcpp-v2.yaml](spec/openapi/rcpp-v2.yaml)。在 OKF 之外，維護中的 Markdown 明確限定為 `AGENTS.md`、`THIRD_PARTY_NOTICES.md`、權威英文 `README.md`，以及在 `assets/readme/locales.json` 中宣告的受支援 `README.<locale>.md` 翻譯。

<!-- readme-section:for-developers -->
<a id="for-developers"></a>

## 開發人員專區

從原始碼建置、檢查並驗證專案。

<details>
<summary>從原始碼建置</summary>

<!-- readme-section:prerequisites -->
<a id="prerequisites"></a>

### 必要條件

- Go `1.26.3`
- Node.js `24`
- npm
- pnpm 或 Node.js `corepack`

<!-- readme-section:build -->
<a id="build"></a>

### 建置

```bash
./scripts/lint_ui.sh
./scripts/check_desktop.sh
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

<!-- readme-section:local-guardrails -->
<a id="local-guardrails"></a>

### 本機防護措施

```bash
./scripts/install_git_hooks.sh
node scripts/generate_third_party_notices.mjs --check
```

附註：

- `internal/**/dist/` 資產由建置產生，並透過 Go `embed` 嵌入。
- 前端 `dist` 資產不會提交至 Git。受追蹤的例外是 `okf/dist/*`，它會以可驗證的 OKF bundle 發行中繼資料形式保留在版本控制中。
- `THIRD_PARTY_NOTICES.md` 由 Go 模組與 JavaScript 鎖定檔產生。相依性變更後請執行 `node scripts/generate_third_party_notices.mjs`，並維持 `--check` 通過。
- `./scripts/lint_ui.sh`、`./scripts/check_desktop.sh`、`./scripts/build_assets.sh` 與 `go test ./...` 是主要的原始碼層級檢查。
- `./scripts/dev_desktop.sh` 會使用新封裝的執行階段，從目前檢出目錄或 worktree 啟動 Desktop。
- `cd desktop && npm run start` 與 `cd desktop && npm run package` 會在 Electron 啟動或封裝 Desktop shell 前準備 `desktop/.bundle/<goos>-<goarch>/redeven`。

</details>

<details>
<summary>本機狀態、發行路徑與疑難排解</summary>

- 本機環境狀態預設位於 `~/.redeven/local-environment/`；Desktop 與獨立執行階段模式也會共用 `~/.redeven/catalog/` 下的設定檔目錄。
- GitHub Releases 是版本化 CLI 壓縮檔、Desktop 安裝程式、總和檢查碼、簽章及 OKF 驗證資產的公開權威來源。
- 如需目前實作詳細資料，請使用 `okf.search` 查詢嵌入式 OKF bundle，或查看 [okf/index.md](okf/index.md)。

</details>

<!-- readme-section:license -->
<a id="license"></a>

## 授權條款

Redeven 採用 [MIT License](LICENSE)。第三方相依性聲明記錄於 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；發行封存檔與 Desktop 軟體套件會在執行階段成品旁一併包含這些檔案。

<!-- readme-section:open-source-scope -->
<a id="open-source-scope"></a>

## 開放原始碼範圍

此公開儲存庫涵蓋端點與執行階段層、Redeven Local UI 行為、Desktop shell 及 GitHub Release 契約。

特定組織的部署自動化、控制平面實作與站台專用封裝程式明確不在此儲存庫範圍內。
