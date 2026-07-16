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
  <a href="README.ko-KR.md">한국어</a> |
  <a href="README.de-DE.md">Deutsch</a> |
  <a href="README.fr-FR.md">Français</a> |
  <a href="README.es-ES.md">Español</a> |
  <strong>Português do Brasil</strong> |
  <a href="README.ru-RU.md">Русский</a>
</p>
<!-- readme-locales:end -->

<p align="center">
  <strong>Seus computadores e servidores em uma única aba do navegador.</strong><br>
  Terminal, gerenciador de arquivos, IDE e IA,
  <br>tudo no seu próprio hardware, com criptografia de ponta a ponta.
</p>

<p align="center">
  <a href="https://github.com/floegence/redeven/releases">Baixar o Desktop</a> |
  <a href="#quick-start">Instalar a CLI</a> |
  <a href="#what-you-can-do">Recursos</a> |
  <a href="#security">Segurança</a> |
  <a href="#documentation">Documentação</a>
</p>

<p align="center">
  <a href="https://go.dev/"><img alt="Versão do Go" src="https://img.shields.io/badge/Go-1.26.3-00ADD8?style=flat-square&logo=go"></a>
  <a href="https://nodejs.org/"><img alt="Versão do Node.js" src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js"></a>
  <a href="okf/index.md"><img alt="Conhecimento OKF" src="https://img.shields.io/badge/Knowledge-OKF%20v0.1-6C3BFF?style=flat-square"></a>
  <a href="https://github.com/floegence/redeven/releases"><img alt="Versões publicadas" src="https://img.shields.io/badge/Releases-GitHub-181717?style=flat-square&logo=github"></a>
</p>

<!-- readme-section:what-is-redeven -->
<a id="what-is-redeven"></a>

## O que é o Redeven?

O Redeven é um único binário que reúne seus computadores e servidores em uma aba do navegador. Em vez de alternar entre terminais SSH, gerenciadores de arquivos, painéis de monitoramento, encaminhamentos de porta e janelas da IDE, você obtém uma área de trabalho unificada no hardware que já controla.

Ele é executado na sua máquina, em servidores remotos ou em qualquer host SSH acessível. Seus arquivos, processos, chaves de API e credenciais permanecem onde devem estar: o Redeven não transporta seus dados em texto simples pela infraestrutura de terceiros.

- **Os clientes se conectam a um ambiente de execução do endpoint**: navegador, Desktop, CLI e sessões hospedadas por SSH entram na mesma área de trabalho gerenciada pelo ambiente de execução.
- **O ambiente de execução é o limite de confiança**: um único binário Go gerencia arquivos, terminais, monitoramento, Git, encaminhamento de serviços web, o layout do Workbench, notas, a configuração do Browser Editor, o Flower e o acesso à ponte do Codex.
- **Transporte e políticas permanecem explícitos**: o Flowersec transporta tráfego RPC e de streams criptografado, enquanto concessões de sessão, política local de permissões, escopo do sistema de arquivos e segredos locais limitam o que cada sessão pode fazer.

![Visão geral da arquitetura do Redeven](assets/readme/architecture-overview.png)

<!-- readme-section:quick-start -->
<a id="quick-start"></a>

## Início rápido

Há dois caminhos para começar: Desktop, recomendado para a maioria dos usuários, ou CLI.

<!-- readme-section:desktop-app -->
<a id="desktop-app"></a>

### Aplicativo Desktop

1. Baixe o Redeven Desktop em [GitHub Releases](https://github.com/floegence/redeven/releases).
2. Abra o aplicativo e escolha seu ambiente: local, Provider, host SSH ou uma URL salva.
3. Comece a trabalhar: a área de trabalho será aberta automaticamente no navegador.

Para máquinas remotas, o Desktop pode instalar automaticamente a versão correspondente do Redeven via SSH e, quando você escolher, conectar explicitamente esse ambiente de execução SSH gerenciado a um ambiente de provider. Não é necessário fazer configuração manual no host remoto.

<!-- readme-section:cli -->
<a id="cli"></a>

### CLI

```bash
# 1. Instalar
curl -fsSL https://raw.githubusercontent.com/floegence/redeven/main/scripts/install.sh | sh

# 2. Executar
redeven run

# 3. Abrir http://localhost:23998 no navegador.
```

Na primeira execução, `redeven run` inicializa o estado local em `~/.redeven/local-environment/` e inicia no modo local. Não é necessário executar o bootstrap nem configurar o plano de controle. A Local UI escuta em `localhost:23998` e só pode ser acessada a partir deste dispositivo; não há suporte para acesso direto pela LAN ou por redes públicas. Pressione Ctrl+C para interromper o ambiente de execução.

Execute `redeven help run` para conhecer outros modos de execução e a proteção local opcional por senha.

<!-- readme-section:what-you-can-do -->
<a id="what-you-can-do"></a>

## O que você pode fazer

| Superfície | Recursos oferecidos |
|---|---|
| Arquivos e Git | Upload e download de arquivos, visualização e edição embutidas, alterações de Git limitadas à pasta, diffs e fluxos de stash. |
| Terminal | Terminais com várias abas, iniciados nos diretórios em que você trabalha e sujeitos ao mesmo modelo de permissões do ambiente de execução. |
| Monitor | Visualizações de CPU, memória, disco, rede e processos fornecidas pelo ambiente de execução do endpoint. |
| Browser Editor | Sessões de editor no navegador configuradas explicitamente pelo Desktop e isoladas por área de trabalho. |
| Serviços web | Registro de serviços e acesso por encaminhamento de portas gerenciados pelo ambiente de execução, sem túneis SSH escritos manualmente. |
| Flower e Codex | Superfícies opcionais de IA que usam ferramentas validadas pelo ambiente de execução e configuração local do modelo e do host. |
| Desktop | Inicializador nativo para ambientes locais, ambientes hospedados por um provider, ambientes inicializados por SSH e ambientes de Local UI salvos. |

<!-- readme-section:security -->
<a id="security"></a>

## Segurança sem tirar o foco dos recursos

O Redeven prioriza os recursos, mas o ambiente de execução continua sendo o limite de confiança porque controla o host real.

- O ambiente de execução reside no endpoint e mantém nele os dados em texto simples.
- O plano de controle emite cargas de inicialização, concessões e metadados de sessão imutáveis.
- O [Flowersec](https://github.com/floegence/flowersec) transporta bytes criptografados entre o cliente e o ambiente de execução do endpoint. A integração atual está documentada para `flowersec-go/v0.20.2`.
- As permissões efetivas vêm de concessões de sessão emitidas pelo servidor e são limitadas pela política local (`read`, `write`, `execute`, `admin`; nenhuma categoria implica outra).
- Configuração local, material E2EE, logs de auditoria e diagnósticos permanecem no diretório de estado do endpoint.
- GitHub Releases continua sendo a fonte pública de referência para binários, somas de verificação, assinaturas e recursos de verificação OKF.

<!-- readme-section:documentation -->
<a id="documentation"></a>

## Documentação

O Redeven mantém o conhecimento do repositório em [OKF v0.1](okf/index.md). O corpus OKF é gerado a partir do comportamento atual do código-fonte e incorporado ao ambiente de execução para `okf.search`.

A superfície de integração com provider legível por máquina fica em [spec/openapi/rcpp-v2.yaml](spec/openapi/rcpp-v2.yaml). Fora do OKF, os arquivos Markdown mantidos são deliberadamente limitados a `AGENTS.md`, `THIRD_PARTY_NOTICES.md`, ao `README.md` canônico e às traduções mantidas `README.<locale>.md` declaradas em `assets/readme/locales.json`.

<!-- readme-section:for-developers -->
<a id="for-developers"></a>

## Para desenvolvedores

Compile, execute o lint e verifique o projeto a partir do código-fonte.

<details>
<summary>Compilar a partir do código-fonte</summary>

<!-- readme-section:prerequisites -->
<a id="prerequisites"></a>

### Pré-requisitos

- Go `1.26.3`
- Node.js `24`
- npm
- pnpm ou Node.js `corepack`

<!-- readme-section:build -->
<a id="build"></a>

### Compilação

```bash
./scripts/lint_ui.sh
./scripts/check_desktop.sh
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

<!-- readme-section:local-guardrails -->
<a id="local-guardrails"></a>

### Proteções locais

```bash
./scripts/install_git_hooks.sh
node scripts/generate_third_party_notices.mjs --check
```

Observações:

- Os recursos `internal/**/dist/` são gerados e incorporados com Go `embed`.
- Os recursos frontend de `dist` não são registrados no Git. A exceção versionada é `okf/dist/*`, que permanece no repositório como metadados verificáveis de lançamento do pacote OKF.
- `THIRD_PARTY_NOTICES.md` é gerado a partir de módulos Go e arquivos de lock JavaScript. Execute `node scripts/generate_third_party_notices.mjs` após alterações de dependência e mantenha `--check` aprovado.
- `./scripts/lint_ui.sh`, `./scripts/check_desktop.sh`, `./scripts/build_assets.sh` e `go test ./...` são as principais verificações no nível do código-fonte.
- `./scripts/dev_desktop.sh` inicia o Desktop a partir do checkout ou worktree atual com um ambiente de execução recém-empacotado.
- `cd desktop && npm run start` e `cd desktop && npm run package` preparam `desktop/.bundle/<goos>-<goarch>/redeven` antes que o Electron inicie ou empacote o shell do Desktop.

</details>

<details>
<summary>Estado local, caminhos de lançamento e solução de problemas</summary>

- O estado do ambiente local fica por padrão em `~/.redeven/local-environment/`. O Desktop e o modo independente do ambiente de execução também compartilham o catálogo de perfis em `~/.redeven/catalog/`.
- GitHub Releases é a fonte pública de referência para tarballs versionados da CLI, instaladores do Desktop, somas de verificação, assinaturas e recursos de verificação do OKF.
- Para detalhes atuais de implementação, consulte o pacote OKF incorporado com `okf.search` ou veja [okf/index.md](okf/index.md).

</details>

<!-- readme-section:license -->
<a id="license"></a>

## Licença

O Redeven é distribuído sob a [MIT License](LICENSE). Avisos sobre dependências de terceiros são mantidos em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Os arquivos compactados dos lançamentos e os pacotes do Desktop incluem esses arquivos junto aos artefatos do ambiente de execução.

<!-- readme-section:open-source-scope -->
<a id="open-source-scope"></a>

## Escopo de código aberto

Este repositório público cobre a camada de endpoint e ambiente de execução, o comportamento da Redeven Local UI, o shell do Desktop e o contrato do GitHub Release.

Automação de implantação específica de organizações, implementações do plano de controle e wrappers de empacotamento específicos de sites ficam deliberadamente fora do escopo.
