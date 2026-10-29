<p align="center">
  <img src="assets/brand/redeven/png/app-icon-256.png" alt="Redeven" width="72">
</p>

# Redeven

**Where machines become workspaces.**

コンピューターやサーバーのファイル、ターミナル、Git、AI をひとつに。ブラウザーで作業し、プロジェクトは自分のマシンに保ちます。

**[公式サイト](https://redeven.com)** · **[デモを試す](https://redeven.com/#product)** · [Desktop を入手](https://redeven.com/download) · [ドキュメント](https://redeven.com/docs)

![実際に動作する Redeven Workbench：ファイル、ターミナル、ノート、システム監視](assets/readme/runtime-workbench.webp)

<!-- readme-section:work -->
<a id="work"></a>

## 次のアイデアを形にする場所

- **自分に合った作業環境を。** Workbench にファイル、ターミナル、ノート、監視を自由に配置できます。
- **アイデアから動くコードへ。** 変更を確認し、エディターを開き、同じマシンで Web サービスを起動できます。
- **Flower と一緒に進める。** 許可した環境のツールを使って作業する AI アシスタントです。

![実際に動作する Redeven のファイルブラウザーでプロジェクトのソースをプレビュー](assets/readme/runtime-files.webp)

Chrome で実際に動作する Redeven を撮影しました。プロジェクトのソースファイルと実際のターミナルセッションを表示しています。

<!-- readme-section:start -->
<a id="start"></a>

## 自分に合った入口を選ぶ

![Desktop は環境センターとローカルランタイムを搭載。Web Center はサーバーに独立して配置でき、各接続先のマシンでは専用のランタイムが動作します](assets/readme/ways-to-connect.svg)

- **[Desktop](https://redeven.com/docs/download-desktop)** — macOS と Linux で手軽に始められます。ローカルランタイムを搭載し、リモート接続も案内します。
- **[ランタイム](https://redeven.com/docs/download-runtime)** — コンピューターやサーバーで直接実行し、ブラウザーから作業環境を開きます。
- **[Web Center](https://redeven.com/docs/environment-center)** — 管理者ひとり向けの専用環境ディレクトリーをホスト。Desktop なしで、承認済みのランタイムをブラウザーから開けます。パッケージの提供状況と設定方法はガイドをご覧ください。

アカウントを使った共有アクセスには、[Redeven Cloud](https://redeven.com/docs/control-plane-providers) をご覧ください。

ファイルとプロセスは接続先のマシンに残ります。Flowersec がリモートセッションを保護します。Web Center はアプリケーションの通信内容を扱う、信頼されたプロキシーです。 [セキュリティーモデルを確認](https://redeven.com/docs/security-architecture)。

<!-- readme-section:documentation -->
<a id="documentation"></a>

## さらに詳しく

[はじめに](https://redeven.com/docs/getting-started) · [デプロイガイド](okf/operations/web-center-deployment.md) · [リリース](https://github.com/floegence/redeven/releases) · [ソース知識ベース · OKF v0.2](okf/index.md)

<details>
<summary>ソースからビルド</summary>

Go `1.27.3` · Node.js `26.7.0` · npm / pnpm

[![Go](https://img.shields.io/badge/Go-1.27.3-00ADD8?style=flat-square&logo=go)](https://go.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-26.7.0-339933?style=flat-square&logo=node.js)](https://nodejs.org/)

```bash
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

開発と検証の要件は [リポジトリーガイド](AGENTS.md) をご覧ください。

</details>

<!-- readme-section:license -->
<a id="license"></a>

## オープンソース

[MIT ライセンス](LICENSE)。ランタイム、Desktop、Web Center のソースを収録しています。 [サードパーティーに関する表記](THIRD_PARTY_NOTICES.md)。

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
