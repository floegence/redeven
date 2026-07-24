<p align="center">
  <img src="assets/brand/redeven/png/app-icon-256.png" alt="Redeven" width="120">
</p>

# Redeven

<!-- readme-locales:start -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.zh-TW.md">繁體中文</a> |
  <strong>日本語</strong> |
  <a href="README.ko-KR.md">한국어</a> |
  <a href="README.de-DE.md">Deutsch</a> |
  <a href="README.fr-FR.md">Français</a> |
  <a href="README.es-ES.md">Español</a> |
  <a href="README.pt-BR.md">Português do Brasil</a> |
  <a href="README.ru-RU.md">Русский</a>
</p>
<!-- readme-locales:end -->

<p align="center">
  <strong>コンピューターとサーバーを、1 つのブラウザータブに。</strong><br>
  ターミナル、ファイルブラウザー、IDE、AI のすべてが、
  <br>自分のハードウェア上で動作し、エンドツーエンドで暗号化されます。
</p>

<p align="center">
  <a href="https://github.com/floegence/redeven/releases">Desktop をダウンロード</a> |
  <a href="#quick-start">CLI をインストール</a> |
  <a href="#what-you-can-do">機能</a> |
  <a href="#security">セキュリティ</a> |
  <a href="#documentation">ドキュメント</a>
</p>

<p align="center">
  <a href="https://go.dev/"><img alt="Go バージョン" src="https://img.shields.io/badge/Go-1.26.3-00ADD8?style=flat-square&logo=go"></a>
  <a href="https://nodejs.org/"><img alt="Node.js バージョン" src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js"></a>
  <a href="okf/index.md"><img alt="OKF ナレッジ" src="https://img.shields.io/badge/Knowledge-OKF%20v0.1-6C3BFF?style=flat-square"></a>
  <a href="https://github.com/floegence/redeven/releases"><img alt="リリース" src="https://img.shields.io/badge/Releases-GitHub-181717?style=flat-square&logo=github"></a>
</p>

<p align="center">
  <img src="assets/readme/redeven-demo.gif" alt="Redeven デモ：ファイル、ターミナル、Git、Workbench、Code Server を 1 つのブラウザータブで利用" width="100%">
</p>

<!-- readme-section:what-is-redeven -->
<a id="what-is-redeven"></a>

## Redeven とは

Redeven は、コンピューターとサーバーを 1 つのブラウザータブにまとめる単一バイナリです。SSH ターミナル、ファイルブラウザー、監視ダッシュボード、ポートフォワーディング、IDE ウィンドウを行き来する代わりに、自分が管理するハードウェア上で統合されたワークスペースを利用できます。

自分のマシン、リモートサーバー、または到達可能な任意の SSH ホストで動作します。ファイル、プロセス、API キー、認証情報は本来あるべき場所に残り、Redeven が第三者のインフラストラクチャー経由で平文データを移動することはありません。

- **クライアントはエンドポイントランタイムに接続**：ブラウザー、Desktop、CLI、SSH ホストのセッションは、すべて同じランタイム管理ワークスペースに入ります。
- **ランタイムが信頼境界**：1 つの Go バイナリが、ファイル、ターミナル、監視、Git、Web サービス転送、Workbench レイアウト、ノート、Browser Editor のセットアップ、Flower、Codex ブリッジへのアクセスを管理します。
- **転送とポリシーを明示**：Flowersec が暗号化された RPC とストリームトラフィックを運び、セッション権限、ローカル権限ポリシー、ファイルシステム範囲、ローカルシークレットが各セッションの操作を制限します。

![Redeven アーキテクチャー概要](assets/readme/architecture-overview.png)

<!-- readme-section:quick-start -->
<a id="quick-start"></a>

## クイックスタート

開始方法は 2 つあります。多くのユーザーには Desktop を推奨しますが、CLI も利用できます。

<!-- readme-section:desktop-app -->
<a id="desktop-app"></a>

### Desktop アプリ

1. [GitHub Releases](https://github.com/floegence/redeven/releases) から Redeven Desktop をダウンロードします。
2. アプリを開き、ローカル、Provider、SSH ホスト、または保存済み URL から環境を選択します。
3. 作業を開始します。ワークスペースはブラウザーで自動的に開きます。

リモートマシンでは、Desktop が SSH 経由で対応する Redeven リリースを自動インストールできます。必要に応じて、その管理対象 SSH ランタイムを provider 環境へ明示的に接続できます。リモートホストで手動設定を行う必要はありません。

<!-- readme-section:cli -->
<a id="cli"></a>

### CLI

```bash
# 1. インストール
curl -fsSL https://raw.githubusercontent.com/floegence/redeven/main/scripts/install.sh | sh

# 2. 実行
redeven run

# 3. ブラウザーで http://localhost:23998 を開く。
```

初めて `redeven run` を実行すると、`~/.redeven/local-environment/` にローカル状態が初期化され、ローカルモードで起動します。ブートストラップやコントロールプレーンの設定は不要です。Local UI は `localhost:23998` でのみ待ち受け、このデバイスからだけ利用できます。LAN や公開ネットワークからの直接アクセスには対応していません。Ctrl+C でランタイムを停止できます。

その他の実行モードや任意のローカルパスワード保護については、`redeven help run` を実行してください。

<!-- readme-section:what-you-can-do -->
<a id="what-you-can-do"></a>

## できること

| サーフェス | 提供される機能 |
|---|---|
| ファイルと Git | ファイルのアップロードとダウンロード、インラインのプレビューと編集、フォルダー単位に限定された Git の変更、差分、stash ワークフロー。 |
| ターミナル | 作業中のディレクトリをルートとし、同じランタイム権限モデルに従うマルチタブターミナル。 |
| 監視 | エンドポイントランタイムから取得する CPU、メモリ、ディスク、ネットワーク、プロセスのビュー。 |
| Browser Editor | Desktop が明示的にセットアップし、ワークスペースごとに分離されたブラウザーエディターセッション。 |
| Web サービス | 手書きの SSH トンネルを使わずに、ランタイム管理のサービス登録とポートフォワーディングによるアクセス。 |
| Flower と Codex | ランタイムで検証されたツールと、ローカルのモデルおよびホスト設定を使用する、必要に応じて利用できる AI サーフェス。 |
| Desktop | ローカル環境、provider でホストされた環境、SSH でブートストラップした環境、保存済みの Local UI 環境に対応するネイティブランチャー。 |

<!-- readme-section:security -->
<a id="security"></a>

## 主役を奪わないセキュリティ

Redeven は機能を前面に出しますが、実際のホストを管理するため、ランタイムが引き続き信頼境界です。

- ランタイムはエンドポイント上で動作し、平文をそこに保持します。
- コントロールプレーンはブートストラップペイロード、権限、不変のセッションメタデータを発行します。
- [Flowersec](https://github.com/floegence/flowersec) はクライアントとエンドポイントランタイムの間で暗号化されたバイト列を転送します。現在のランタイム統合は `flowersec-go/v0.27.0` を基準に記述されています。
- 有効な権限はサーバー発行のセッション権限から得られ、ローカル権限ポリシーによって制限されます（`read`、`write`、`execute`、`admin`。どのカテゴリも他のカテゴリを暗黙に含みません）。
- ローカル設定、E2EE 資料、監査ログ、診断情報はエンドポイントの状態ディレクトリに残ります。
- GitHub Releases は、バイナリ、チェックサム、署名、OKF 検証アセットの公開された信頼できる情報源です。

<!-- readme-section:documentation -->
<a id="documentation"></a>

## ドキュメント

Redeven は、保守対象のリポジトリ知識を [OKF v0.1](okf/index.md) に集約しています。OKF コーパスは現在のソースレベルの動作から生成され、`okf.search` 用にランタイムへ埋め込まれます。

機械可読な provider 統合サーフェスは [spec/openapi/rcpp-v2.yaml](spec/openapi/rcpp-v2.yaml) にあります。OKF 以外で保守する Markdown は、`AGENTS.md`、`THIRD_PARTY_NOTICES.md`、正本の `README.md`、および `assets/readme/locales.json` で宣言された対応 `README.<locale>.md` 翻訳に限定されます。

<!-- readme-section:for-developers -->
<a id="for-developers"></a>

## 開発者向け

ソースからビルド、lint、検証を行います。

<details>
<summary>ソースからビルド</summary>

<!-- readme-section:prerequisites -->
<a id="prerequisites"></a>

### 前提条件

- Go `1.26.3`
- Node.js `24`
- npm
- pnpm または Node.js `corepack`

<!-- readme-section:build -->
<a id="build"></a>

### ビルド

```bash
./scripts/lint_ui.sh
./scripts/check_desktop.sh
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

<!-- readme-section:local-guardrails -->
<a id="local-guardrails"></a>

### ローカルガードレール

```bash
./scripts/install_git_hooks.sh
node scripts/generate_third_party_notices.mjs --check
```

注意事項：

- `internal/**/dist/` アセットは生成され、Go の `embed` で埋め込まれます。
- フロントエンドの `dist` アセットは Git にコミットしません。追跡対象の例外は `okf/dist/*` で、検証可能な OKF bundle リリースメタデータとしてコミットされます。
- `THIRD_PARTY_NOTICES.md` は Go モジュールと JavaScript ロックファイルから生成されます。依存関係の変更後に `node scripts/generate_third_party_notices.mjs` を実行し、`--check` を通過させてください。
- `./scripts/lint_ui.sh`、`./scripts/check_desktop.sh`、`./scripts/build_assets.sh`、`go test ./...` が主なソースレベルのチェックです。
- `./scripts/dev_desktop.sh` は、現在のチェックアウトまたは worktree から、新しくバンドルしたランタイムを使って Desktop を起動します。
- `cd desktop && npm run start` と `cd desktop && npm run package` は、Electron が Desktop シェルを起動またはパッケージ化する前に `desktop/.bundle/<goos>-<goarch>/redeven` を準備します。

</details>

<details>
<summary>ローカル状態、リリース経路、トラブルシューティング</summary>

- ローカル環境の状態は既定で `~/.redeven/local-environment/` に保存されます。Desktop とスタンドアロンランタイムモードは、`~/.redeven/catalog/` にあるプロファイルカタログも共有します。
- GitHub Releases は、バージョン付き CLI アーカイブ、Desktop インストーラー、チェックサム、署名、OKF 検証アセットの公開された信頼できる情報源です。
- 現在の実装詳細は、`okf.search` で埋め込み OKF bundle を検索するか、[okf/index.md](okf/index.md) を参照してください。

</details>

<!-- readme-section:license -->
<a id="license"></a>

## ライセンス

Redeven は [MIT License](LICENSE) の下で提供されます。第三者依存関係の通知は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) に記録され、リリースアーカイブと Desktop パッケージにはランタイム成果物とともにこれらのファイルが含まれます。

<!-- readme-section:open-source-scope -->
<a id="open-source-scope"></a>

## オープンソースの範囲

この公開リポジトリは、エンドポイントおよびランタイム層、Redeven Local UI の動作、Desktop シェル、GitHub Release 契約を対象とします。

組織固有のデプロイ自動化、コントロールプレーン実装、サイト固有のパッケージングラッパーは、意図的に対象外としています。
