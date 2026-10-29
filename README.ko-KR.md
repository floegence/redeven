<p align="center">
  <img src="assets/brand/redeven/png/app-icon-256.png" alt="Redeven" width="72">
</p>

# Redeven

**Where machines become workspaces.**

컴퓨터와 서버의 파일, 터미널, Git, AI를 한곳에 모으세요. 브라우저에서 작업하고, 프로젝트는 내 장치에 그대로 두세요.

**[공식 웹사이트](https://redeven.com)** · **[데모 체험](https://redeven.com/#product)** · [Desktop 다운로드](https://redeven.com/download) · [문서](https://redeven.com/docs)

![실제로 실행 중인 Redeven Workbench의 파일, 터미널, 메모, 시스템 모니터링](assets/readme/runtime-workbench.webp)

<!-- readme-section:work -->
<a id="work"></a>

## 다음 아이디어를 실현할 공간

- **나에게 맞는 작업 흐름.** Workbench에 파일, 터미널, 메모, 모니터링을 자유롭게 배치하세요.
- **아이디어에서 실행 가능한 코드로.** 변경 사항을 살펴보고 편집기를 열어 같은 장치에서 웹 서비스를 실행하세요.
- **Flower와 함께 진행하세요.** 사용자가 허용한 환경의 도구로 작업하는 AI 도우미입니다.

![실행 중인 Redeven 파일 탐색기에서 프로젝트 소스 미리 보기](assets/readme/runtime-files.webp)

Chrome에서 실제로 실행 중인 Redeven을 캡처했습니다. 프로젝트 소스 파일과 실제 터미널 세션을 보여 줍니다.

<!-- readme-section:start -->
<a id="start"></a>

## 나에게 맞는 시작점

![Desktop은 환경 센터와 로컬 런타임을 포함합니다. Web Center는 서버에 독립 배포되며, 각 대상 장치는 자체 런타임을 유지합니다](assets/readme/ways-to-connect.svg)

- **[Desktop](https://redeven.com/docs/download-desktop)** — macOS와 Linux에서 가장 간편하게 시작하세요. 로컬 런타임을 포함하고 원격 연결을 안내합니다.
- **[런타임](https://redeven.com/docs/download-runtime)** — 컴퓨터나 서버에서 직접 실행하고 브라우저로 작업 공간을 여세요.
- **[Web Center](https://redeven.com/docs/environment-center)** — 관리자 한 명을 위한 비공개 환경 디렉터리를 호스팅하세요. Desktop 없이 브라우저에서 승인된 런타임을 열 수 있습니다. 패키지 제공 여부와 설치 방법은 가이드를 참고하세요.

계정 기반 공유 접근이 필요하다면 [Redeven Cloud](https://redeven.com/docs/control-plane-providers)를 살펴보세요.

파일과 프로세스는 대상 장치에 유지됩니다. Flowersec이 원격 세션을 보호합니다. Web Center는 애플리케이션 트래픽을 볼 수 있는 신뢰된 프록시입니다. [보안 모델 알아보기](https://redeven.com/docs/security-architecture).

<!-- readme-section:documentation -->
<a id="documentation"></a>

## 더 알아보기

[시작 가이드](https://redeven.com/docs/getting-started) · [배포 가이드](okf/operations/web-center-deployment.md) · [릴리스](https://github.com/floegence/redeven/releases) · [소스 지식 베이스 · OKF v0.2](okf/index.md)

<details>
<summary>소스에서 빌드</summary>

Go `1.27.3` · Node.js `26.7.0` · npm / pnpm

[![Go](https://img.shields.io/badge/Go-1.27.3-00ADD8?style=flat-square&logo=go)](https://go.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-26.7.0-339933?style=flat-square&logo=node.js)](https://nodejs.org/)

```bash
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

개발 및 검증 요건은 [저장소 가이드](AGENTS.md)를 참고하세요.

</details>

<!-- readme-section:license -->
<a id="license"></a>

## 오픈 소스

[MIT 라이선스](LICENSE). 런타임, Desktop, Web Center의 소스가 이 저장소에 있습니다. [서드 파티 고지](THIRD_PARTY_NOTICES.md).

<!-- readme-locales:start -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.zh-TW.md">繁體中文</a> |
  <a href="README.ja-JP.md">日本語</a> |
  <strong>한국어</strong> |
  <a href="README.de-DE.md">Deutsch</a> |
  <a href="README.fr-FR.md">Français</a> |
  <a href="README.es-ES.md">Español</a> |
  <a href="README.pt-BR.md">Português do Brasil</a> |
  <a href="README.ru-RU.md">Русский</a>
</p>
<!-- readme-locales:end -->
