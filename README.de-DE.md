<p align="center">
  <img src="assets/brand/redeven/png/app-icon-256.png" alt="Redeven" width="72">
</p>

# Redeven

**Where machines become workspaces.**

Deine Computer und Server, vereint mit Dateien, Terminals, Git und KI. Arbeite im Browser. Deine Projekte bleiben auf deinen Rechnern.

**[Website](https://redeven.com)** · **[Demo ausprobieren](https://redeven.com/#product)** · [Desktop herunterladen](https://redeven.com/download) · [Dokumentation](https://redeven.com/docs)

![Laufender Redeven Workbench mit echten Dateien, Terminal, Notizen und Systemüberwachung](assets/readme/runtime-workbench.webp)

<!-- readme-section:work -->
<a id="work"></a>

## Alles für deine nächste Idee

- **Platz für deinen Arbeitsablauf.** Ordne Dateien, Terminals, Notizen und Monitoring auf Workbench an.
- **Von der Idee zum lauffähigen Code.** Prüfe Änderungen, öffne deinen Editor und starte Webdienste auf demselben Rechner.
- **Arbeite mit Flower.** Ein KI-Assistent, der mit deiner Erlaubnis die Werkzeuge deiner Umgebung nutzt.

![Der Dateibrowser einer laufenden Redeven-Instanz zeigt den Projektquelltext](assets/readme/runtime-files.webp)

Aufgenommen in einer laufenden Redeven-Instanz in Chrome, mit den Quelldateien des Projekts und einer echten Terminalsitzung.

<!-- readme-section:start -->
<a id="start"></a>

## Der passende Einstieg für dich

![Desktop vereint Umgebungszentrale und lokale Laufzeit; Web Center läuft unabhängig auf deinem Server; jeder Zielrechner behält seine eigene Laufzeit](assets/readme/ways-to-connect.svg)

- **[Desktop](https://redeven.com/docs/download-desktop)** — der einfachste Einstieg unter macOS und Linux, mit integrierter lokaler Laufzeit und geführten Remote-Verbindungen.
- **[Laufzeit](https://redeven.com/docs/download-runtime)** — direkt auf einem Computer oder Server ausführen und die Arbeitsumgebung im Browser öffnen.
- **[Web Center](https://redeven.com/docs/environment-center)** — hoste ein privates Umgebungsverzeichnis für einen Administrator. Öffne freigegebene Laufzeiten im Browser, ohne Desktop. Paketverfügbarkeit und Einrichtung findest du im Leitfaden.

Gemeinsamer Zugriff über Benutzerkonten? Entdecke [Redeven Cloud](https://redeven.com/docs/control-plane-providers).

Dateien und Prozesse bleiben auf dem Zielrechner. Flowersec schützt Remote-Sitzungen; Web Center ist ein vertrauenswürdiger Proxy, der den Anwendungsverkehr einsehen kann. [Das Sicherheitsmodell verstehen](https://redeven.com/docs/security-architecture).

<!-- readme-section:documentation -->
<a id="documentation"></a>

## Mehr erfahren

[Erste Schritte](https://redeven.com/docs/getting-started) · [Bereitstellungsleitfaden](okf/operations/web-center-deployment.md) · [Versionen](https://github.com/floegence/redeven/releases) · [Quellcode-Wissen · OKF v0.2](okf/index.md)

<details>
<summary>Aus dem Quellcode bauen</summary>

Go `1.27.3` · Node.js `26.7.0` · npm / pnpm

[![Go](https://img.shields.io/badge/Go-1.27.3-00ADD8?style=flat-square&logo=go)](https://go.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-26.7.0-339933?style=flat-square&logo=node.js)](https://nodejs.org/)

```bash
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

Die [Repository-Anleitung](AGENTS.md) beschreibt Entwicklung und Validierung.

</details>

<!-- readme-section:license -->
<a id="license"></a>

## Open Source

[MIT-Lizenz](LICENSE). Hier liegen Laufzeit, Desktop und Web Center. [Hinweise zu Drittanbietern](THIRD_PARTY_NOTICES.md).

<!-- readme-locales:start -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.zh-TW.md">繁體中文</a> |
  <a href="README.ja-JP.md">日本語</a> |
  <a href="README.ko-KR.md">한국어</a> |
  <strong>Deutsch</strong> |
  <a href="README.fr-FR.md">Français</a> |
  <a href="README.es-ES.md">Español</a> |
  <a href="README.pt-BR.md">Português do Brasil</a> |
  <a href="README.ru-RU.md">Русский</a>
</p>
<!-- readme-locales:end -->
