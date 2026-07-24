<p align="center">
  <img src="assets/brand/redeven/png/app-icon-256.png" alt="Redeven" width="120">
</p>

# Redeven

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

<p align="center">
  <strong>컴퓨터와 서버를 하나의 브라우저 탭에서.</strong><br>
  터미널, 파일 브라우저, IDE, AI를
  <br>모두 자체 하드웨어에서 엔드투엔드 암호화로 이용하세요.
</p>

<p align="center">
  <a href="https://github.com/floegence/redeven/releases">Desktop 다운로드</a> |
  <a href="#quick-start">CLI 설치</a> |
  <a href="#what-you-can-do">기능</a> |
  <a href="#security">보안</a> |
  <a href="#documentation">문서</a>
</p>

<p align="center">
  <a href="https://go.dev/"><img alt="Go 버전" src="https://img.shields.io/badge/Go-1.26.3-00ADD8?style=flat-square&logo=go"></a>
  <a href="https://nodejs.org/"><img alt="Node.js 버전" src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js"></a>
  <a href="okf/index.md"><img alt="OKF 지식" src="https://img.shields.io/badge/Knowledge-OKF%20v0.1-6C3BFF?style=flat-square"></a>
  <a href="https://github.com/floegence/redeven/releases"><img alt="릴리스" src="https://img.shields.io/badge/Releases-GitHub-181717?style=flat-square&logo=github"></a>
</p>

<p align="center">
  <img src="assets/readme/redeven-demo.gif" alt="Redeven 데모: 파일, 터미널, Git, Workbench, Code Server를 하나의 브라우저 탭에서 사용" width="100%">
</p>

<!-- readme-section:what-is-redeven -->
<a id="what-is-redeven"></a>

## Redeven이란?

Redeven은 컴퓨터와 서버를 하나의 브라우저 탭으로 가져오는 단일 바이너리입니다. SSH 터미널, 파일 브라우저, 모니터링 대시보드, 포트 포워딩, IDE 창을 번갈아 사용할 필요 없이 직접 관리하는 하드웨어에서 하나로 통합된 작업 공간을 사용할 수 있습니다.

내 컴퓨터, 원격 서버 또는 연결 가능한 모든 SSH 호스트에서 실행됩니다. 파일, 프로세스, API 키, 자격 증명은 원래 있어야 할 곳에 남으며, Redeven은 사용자의 평문 데이터를 다른 사람의 인프라를 통해 이동시키지 않습니다.

- **클라이언트는 엔드포인트 런타임에 연결됩니다**: 브라우저, Desktop, CLI, SSH 호스트 세션이 모두 동일한 런타임 관리 작업 공간으로 들어갑니다.
- **런타임이 신뢰 경계입니다**: 하나의 Go 바이너리가 파일, 터미널, 모니터링, Git, 웹 서비스 포워딩, Workbench 레이아웃, 메모, Browser Editor 설정, Flower, Codex 브리지 접근을 관리합니다.
- **전송과 정책을 명확하게 유지합니다**: Flowersec은 암호화된 RPC와 스트림 트래픽을 전달하며, 세션 권한, 로컬 권한 정책, 파일 시스템 범위, 로컬 시크릿이 각 세션에서 할 수 있는 작업을 제한합니다.

![Redeven 아키텍처 개요](assets/readme/architecture-overview.png)

<!-- readme-section:quick-start -->
<a id="quick-start"></a>

## 빠른 시작

시작 방법은 두 가지입니다. 대부분의 사용자에게 권장하는 Desktop 또는 CLI를 사용할 수 있습니다.

<!-- readme-section:desktop-app -->
<a id="desktop-app"></a>

### Desktop 앱

1. [GitHub Releases](https://github.com/floegence/redeven/releases)에서 Redeven Desktop을 다운로드합니다.
2. 앱을 열고 로컬, Provider, SSH 호스트 또는 저장된 URL 중에서 환경을 선택합니다.
3. 작업을 시작하면 작업 공간이 브라우저에서 자동으로 열립니다.

원격 컴퓨터의 경우 Desktop이 SSH를 통해 일치하는 Redeven 릴리스를 자동 설치할 수 있습니다. 이후 사용자가 선택하면 해당 관리형 SSH 런타임을 provider 환경에 명시적으로 연결합니다. 원격 호스트에서 수동으로 설정할 필요가 없습니다.

<!-- readme-section:cli -->
<a id="cli"></a>

### CLI

```bash
# 1. 설치
curl -fsSL https://raw.githubusercontent.com/floegence/redeven/main/scripts/install.sh | sh

# 2. 실행
redeven run

# 3. 브라우저에서 http://localhost:23998 열기
```

`redeven run`을 처음 실행하면 `~/.redeven/local-environment/`에 로컬 상태를 초기화하고 로컬 모드로 시작합니다. 부트스트랩이나 컨트롤 플레인 설정은 필요하지 않습니다. Local UI는 `localhost:23998`에서만 연결을 수신하므로 이 기기에서만 사용할 수 있습니다. LAN 또는 공용 네트워크를 통한 직접 접근은 지원하지 않습니다. Ctrl+C를 누르면 런타임이 중지됩니다.

다른 실행 모드와 선택적 로컬 암호 보호에 관한 내용은 `redeven help run`에서 확인할 수 있습니다.

<!-- readme-section:what-you-can-do -->
<a id="what-you-can-do"></a>

## 할 수 있는 작업

| 화면 | 제공 기능 |
|---|---|
| 파일 및 Git | 파일 업로드와 다운로드, 인라인 미리보기와 편집, 폴더 범위 Git 변경, diff, stash 워크플로. |
| 터미널 | 현재 작업 중인 디렉터리를 루트로 사용하고 동일한 런타임 권한 모델을 따르는 다중 탭 터미널. |
| 모니터 | 엔드포인트 런타임에서 제공하는 CPU, 메모리, 디스크, 네트워크, 프로세스 보기. |
| Browser Editor | Desktop이 명시적으로 설정하고 작업 공간별로 격리한 브라우저 편집기 세션. |
| 웹 서비스 | 직접 SSH 터널을 작성하지 않고 사용할 수 있는 런타임 관리형 서비스 등록 및 포트 포워딩. |
| Flower 및 Codex | 런타임에서 검증한 도구와 로컬 모델 및 호스트 설정을 사용하는 선택형 AI 화면. |
| Desktop | 로컬, provider 호스팅, SSH 부트스트랩, 저장된 Local UI 환경을 위한 네이티브 실행기. |

<!-- readme-section:security -->
<a id="security"></a>

## 기능을 가리지 않는 보안

Redeven은 기능을 앞세우지만, 런타임이 실제 호스트를 제어하므로 런타임은 여전히 신뢰 경계입니다.

- 런타임은 엔드포인트에 존재하며 평문을 그곳에 유지합니다.
- 컨트롤 플레인은 부트스트랩 페이로드, 권한, 변경 불가능한 세션 메타데이터를 발급합니다.
- [Flowersec](https://github.com/floegence/flowersec)은 클라이언트와 엔드포인트 런타임 사이에서 암호화된 바이트를 전송합니다. 현재 런타임 통합은 `flowersec-go/v0.27.0`를 기준으로 문서화되어 있습니다.
- 유효 권한은 서버가 발급한 세션 권한에서 나오며 로컬 권한 정책으로 제한됩니다(`read`, `write`, `execute`, `admin`; 어떤 범주도 다른 범주를 암시하지 않습니다).
- 로컬 설정, E2EE 자료, 감사 로그, 진단 정보는 엔드포인트 상태 디렉터리에 남습니다.
- GitHub Releases는 바이너리, 체크섬, 서명, OKF 검증 자산의 공개 기준 정보입니다.

<!-- readme-section:documentation -->
<a id="documentation"></a>

## 문서

Redeven은 관리되는 저장소 지식을 [OKF v0.1](okf/index.md)에 보관합니다. OKF 코퍼스는 현재 소스 수준 동작에서 생성되며 `okf.search`를 위해 런타임에 포함됩니다.

기계 판독 가능한 provider 통합 인터페이스는 [spec/openapi/rcpp-v2.yaml](spec/openapi/rcpp-v2.yaml)에 정의되어 있습니다. OKF 외부에서 관리하는 Markdown은 `AGENTS.md`, `THIRD_PARTY_NOTICES.md`, 기준 `README.md`, `assets/readme/locales.json`에 선언된 지원 `README.<locale>.md` 번역으로 제한됩니다.

<!-- readme-section:for-developers -->
<a id="for-developers"></a>

## 개발자용

소스에서 빌드하고 lint 및 검증을 실행합니다.

<details>
<summary>소스에서 빌드</summary>

<!-- readme-section:prerequisites -->
<a id="prerequisites"></a>

### 사전 요구 사항

- Go `1.26.3`
- Node.js `24`
- npm
- pnpm 또는 Node.js `corepack`

<!-- readme-section:build -->
<a id="build"></a>

### 빌드

```bash
./scripts/lint_ui.sh
./scripts/check_desktop.sh
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

<!-- readme-section:local-guardrails -->
<a id="local-guardrails"></a>

### 로컬 보호 장치

```bash
./scripts/install_git_hooks.sh
node scripts/generate_third_party_notices.mjs --check
```

참고:

- `internal/**/dist/` 자산은 생성된 뒤 Go `embed`로 포함됩니다.
- 프런트엔드 `dist` 자산은 Git에 커밋하지 않습니다. 추적되는 예외는 검증 가능한 OKF bundle 릴리스 메타데이터로 커밋되는 `okf/dist/*`입니다.
- `THIRD_PARTY_NOTICES.md`는 Go 모듈과 JavaScript 잠금 파일에서 생성됩니다. 의존성을 변경한 뒤 `node scripts/generate_third_party_notices.mjs`를 실행하고 `--check`를 통과시키세요.
- `./scripts/lint_ui.sh`, `./scripts/check_desktop.sh`, `./scripts/build_assets.sh`, `go test ./...`는 주요 소스 수준 검사입니다.
- `./scripts/dev_desktop.sh`는 현재 체크아웃 또는 worktree에서 새로 번들된 런타임으로 Desktop을 시작합니다.
- `cd desktop && npm run start`와 `cd desktop && npm run package`는 Electron이 Desktop 셸을 시작하거나 패키징하기 전에 `desktop/.bundle/<goos>-<goarch>/redeven`을 준비합니다.

</details>

<details>
<summary>로컬 상태, 릴리스 경로 및 문제 해결</summary>

- 로컬 환경 상태는 기본적으로 `~/.redeven/local-environment/`에 저장되며, Desktop과 독립 실행형 런타임 모드는 `~/.redeven/catalog/` 아래의 프로필 카탈로그도 공유합니다.
- GitHub Releases는 버전이 지정된 CLI 아카이브, Desktop 설치 프로그램, 체크섬, 서명, OKF 검증 자산의 공개 기준 정보입니다.
- 현재 구현 세부 정보는 `okf.search`로 내장 OKF bundle을 조회하거나 [okf/index.md](okf/index.md)를 확인하세요.

</details>

<!-- readme-section:license -->
<a id="license"></a>

## 라이선스

Redeven은 [MIT License](LICENSE)에 따라 제공됩니다. 타사 의존성 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에서 관리하며, 릴리스 아카이브와 Desktop 패키지는 런타임 산출물과 함께 이 파일들을 포함합니다.

<!-- readme-section:open-source-scope -->
<a id="open-source-scope"></a>

## 오픈 소스 범위

이 공개 저장소는 엔드포인트 및 런타임 계층, Redeven Local UI 동작, Desktop 셸, GitHub Release 계약을 다룹니다.

조직별 배포 자동화, 컨트롤 플레인 구현, 사이트별 패키징 래퍼는 의도적으로 범위에서 제외됩니다.
