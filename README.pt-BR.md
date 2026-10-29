<p align="center">
  <img src="assets/brand/redeven/png/app-icon-256.png" alt="Redeven" width="72">
</p>

# Redeven

**Where machines become workspaces.**

Seus computadores e servidores, com arquivos, terminais, Git e IA em um só lugar. Trabalhe no navegador. Mantenha seus projetos nas suas máquinas.

**[Site oficial](https://redeven.com)** · **[Experimentar a demo](https://redeven.com/#product)** · [Baixar Desktop](https://redeven.com/download) · [Documentação](https://redeven.com/docs)

![Redeven Workbench em execução com arquivos reais, terminal, notas e monitoramento do sistema](assets/readme/runtime-workbench.webp)

<!-- readme-section:work -->
<a id="work"></a>

## Tudo para sua próxima ideia

- **Espaço para o seu jeito de trabalhar.** Organize arquivos, terminais, notas e monitoramento no Workbench.
- **Da ideia ao código funcionando.** Revise alterações, abra seu editor e inicie serviços web na mesma máquina.
- **Trabalhe com o Flower.** Um assistente de IA que usa as ferramentas do seu ambiente com a sua permissão.

![O navegador de arquivos do Redeven exibe o código-fonte do projeto em uma instância em execução](assets/readme/runtime-files.webp)

Capturas de uma instância do Redeven em execução no Chrome, com os arquivos-fonte do projeto e uma sessão real de terminal.

<!-- readme-section:start -->
<a id="start"></a>

## Escolha seu ponto de partida

![Desktop reúne uma central de ambientes e um motor local; Web Center roda de forma independente no seu servidor; cada máquina de destino mantém seu próprio motor](assets/readme/ways-to-connect.svg)

- **[Desktop](https://redeven.com/docs/download-desktop)** — o jeito mais simples de começar no macOS e no Linux, com um motor local integrado e conexões remotas guiadas.
- **[Motor](https://redeven.com/docs/download-runtime)** — execute diretamente em um computador ou servidor e abra seu espaço de trabalho no navegador.
- **[Web Center](https://redeven.com/docs/environment-center)** — hospede um diretório privado de ambientes para um administrador. Abra motores autorizados pelo navegador, sem Desktop. Consulte a disponibilidade de pacotes e a configuração no guia.

Precisa de acesso compartilhado por contas? Conheça o [Redeven Cloud](https://redeven.com/docs/control-plane-providers).

Arquivos e processos ficam na máquina de destino. Flowersec protege as sessões remotas; Web Center é um proxy confiável que pode ver o tráfego das aplicações. [Entenda o modelo de segurança](https://redeven.com/docs/security-architecture).

<!-- readme-section:documentation -->
<a id="documentation"></a>

## Explore mais

[Primeiros passos](https://redeven.com/docs/getting-started) · [Guia de implantação](okf/operations/web-center-deployment.md) · [Versões](https://github.com/floegence/redeven/releases) · [Conhecimento do código · OKF v0.2](okf/index.md)

<details>
<summary>Compilar a partir do código-fonte</summary>

Go `1.27.3` · Node.js `26.7.0` · npm / pnpm

[![Go](https://img.shields.io/badge/Go-1.27.3-00ADD8?style=flat-square&logo=go)](https://go.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-26.7.0-339933?style=flat-square&logo=node.js)](https://nodejs.org/)

```bash
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

Consulte o [guia do repositório](AGENTS.md) para os requisitos de desenvolvimento e validação.

</details>

<!-- readme-section:license -->
<a id="license"></a>

## Código aberto

[Licença MIT](LICENSE). O motor, o Desktop e o Web Center estão neste repositório. [Avisos de terceiros](THIRD_PARTY_NOTICES.md).

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
