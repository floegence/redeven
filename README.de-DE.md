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
  <strong>Deutsch</strong> |
  <a href="README.fr-FR.md">Français</a> |
  <a href="README.es-ES.md">Español</a> |
  <a href="README.pt-BR.md">Português do Brasil</a> |
  <a href="README.ru-RU.md">Русский</a>
</p>
<!-- readme-locales:end -->

<p align="center">
  <strong>Deine Computer und Server in einem Browser-Tab.</strong><br>
  Terminal, Dateibrowser, IDE und KI,
  <br>alles auf deiner eigenen Hardware und Ende-zu-Ende verschlüsselt.
</p>

<p align="center">
  <a href="https://github.com/floegence/redeven/releases">Desktop herunterladen</a> |
  <a href="#quick-start">CLI installieren</a> |
  <a href="#what-you-can-do">Funktionen</a> |
  <a href="#security">Sicherheit</a> |
  <a href="#documentation">Dokumentation</a>
</p>

<p align="center">
  <a href="https://go.dev/"><img alt="Go-Version" src="https://img.shields.io/badge/Go-1.26.3-00ADD8?style=flat-square&logo=go"></a>
  <a href="https://nodejs.org/"><img alt="Node.js-Version" src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js"></a>
  <a href="okf/index.md"><img alt="OKF-Wissen" src="https://img.shields.io/badge/Knowledge-OKF%20v0.1-6C3BFF?style=flat-square"></a>
  <a href="https://github.com/floegence/redeven/releases"><img alt="Releases" src="https://img.shields.io/badge/Releases-GitHub-181717?style=flat-square&logo=github"></a>
</p>

<!-- readme-section:what-is-redeven -->
<a id="what-is-redeven"></a>

## Was ist Redeven?

Redeven ist eine einzelne Binärdatei, die deine Computer und Server in einem Browser-Tab zusammenführt. Statt zwischen SSH-Terminals, Dateibrowsern, Monitoring-Dashboards, Portweiterleitungen und IDE-Fenstern zu wechseln, erhältst du einen einheitlichen Arbeitsbereich auf der Hardware, die du selbst kontrollierst.

Redeven läuft auf deinem Rechner, auf entfernten Servern oder auf jedem erreichbaren SSH-Host. Deine Dateien, Prozesse, API-Schlüssel und Zugangsdaten bleiben dort, wo sie hingehören. Redeven überträgt deine Klartextdaten nicht durch fremde Infrastruktur.

- **Clients verbinden sich mit einer Endpunkt-Laufzeit**: Browser, Desktop, CLI und über SSH gehostete Sitzungen greifen auf denselben von der Laufzeit verwalteten Arbeitsbereich zu.
- **Die Laufzeit ist die Vertrauensgrenze**: Eine einzelne Go-Binärdatei verwaltet Dateien, Terminals, Monitoring, Git, die Weiterleitung von Webdiensten, das Workbench-Layout, Notizen, die Einrichtung von Browser Editor, Flower und den Codex-Bridge-Zugriff.
- **Transport und Richtlinien bleiben explizit**: Flowersec transportiert verschlüsselten RPC- und Stream-Datenverkehr. Sitzungsfreigaben, lokale Berechtigungsrichtlinien, Dateisystemumfang und lokale Geheimnisse begrenzen die Möglichkeiten jeder Sitzung.

![Architekturübersicht von Redeven](assets/readme/architecture-overview.png)

<!-- readme-section:quick-start -->
<a id="quick-start"></a>

## Schnellstart

Es gibt zwei Wege für den Einstieg: Desktop, empfohlen für die meisten Benutzer, oder die CLI.

<!-- readme-section:desktop-app -->
<a id="desktop-app"></a>

### Desktop-App

1. Lade Redeven Desktop über [GitHub Releases](https://github.com/floegence/redeven/releases) herunter.
2. Öffne die App und wähle deine Umgebung: lokal, Provider, SSH-Host oder eine gespeicherte URL.
3. Beginne mit der Arbeit. Der Arbeitsbereich öffnet sich automatisch im Browser.

Für entfernte Rechner kann Desktop die passende Redeven-Version automatisch über SSH installieren. Anschließend verbindet Desktop die verwaltete SSH-Laufzeit auf deine ausdrückliche Auswahl hin mit einer provider-Umgebung. Auf dem entfernten Host ist keine manuelle Einrichtung erforderlich.

<!-- readme-section:cli -->
<a id="cli"></a>

### CLI

```bash
# 1. Installieren
curl -fsSL https://raw.githubusercontent.com/floegence/redeven/main/scripts/install.sh | sh

# 2. Bootstrap ausführen (einmalig, Ticket aus einer geschützten Secret-Datei lesen)
redeven bootstrap \
  --provider-origin https://<your-provider> \
  --controlplane https://<your-access-point> \
  --env-id <env_public_id> \
  --bootstrap-ticket-file /run/secrets/redeven-bootstrap-ticket

# 3. Starten
redeven run --mode hybrid

# 4. http://localhost:23998 im Browser öffnen.
```

Der Bootstrap schreibt nicht geheime Metadaten der lokalen Umgebung nach `~/.redeven/local-environment/config.json` und Laufzeit-Zugangsdaten in die zugriffsbeschränkte Datei `~/.redeven/local-environment/secrets.json`. Jeder Betriebssystembenutzer besitzt genau eine Identität für die lokale Umgebung, die zu einem Zeitpunkt an genau eine provider-Umgebung gebunden ist. Desktop und Browser verwenden denselben Vertrag für einmalige Tickets.

Ersetze für eine interaktive einmalige Einrichtung die obige Option `--bootstrap-ticket-file ...` durch `--bootstrap-ticket-stdin`. Redeven fragt dann nach dem Ticket, ohne die Eingabe anzuzeigen. Wenn stdin eine Pipe oder Umleitung ist, liest dieselbe Option das Ticket direkt und ohne Eingabeaufforderung.

Automatisierungssysteme, Secret-Manager, CI-Runner und Container-Orchestratoren können `REDEVEN_BOOTSTRAP_TICKET` und `REDEVEN_LOCAL_UI_PASSWORD` direkt bereitstellen. Umgebungsvariablen bleiben für Prozesse desselben Benutzers, Debugger und die Hostplattform sichtbar. Für interaktive Verwendung sind daher verdeckte Eingaben, stdin oder geschützte Secret-Dateien vorzuziehen.

Interaktive Terminals verwenden standardmäßig die umfangreiche Laufzeitdarstellung von Redeven: eine kompakte animierte Zeichenmarke, Laufzeit- und Protokolldetails, die Anzahl aktiver Sitzungen und Workloads, URLs für Local UI und Umgebung, echte Laufzeitprotokolle sowie direkt umsetzbare Warnungs- und Fehlerbereiche. Mit den Pfeiltasten wechselst du zwischen Steuerungsebene, Sitzungen und Logs. Enter auf Sitzungen öffnet eine filterbare Ansicht aktiver Sitzungen, Enter auf Logs erweitert das vollständige Laufzeitprotokoll und Enter auf der Steuerungsebene öffnet Verbinden, Trennen oder die Bootstrap-Einstellungen. Esc führt zurück und Strg+C beendet die Laufzeit. Nicht interaktive Shells verwenden Klartext. Von Desktop verwaltete Starts verwenden statt einer Terminaloberfläche den Maschinen-Darstellungsvertrag mit strukturierten Startberichten.

**Ausführungsmodi auf einen Blick:**

| Ziel | Befehl |
|---|---|
| Nur Local UI auf diesem Gerät | `redeven run --mode local` |
| Local UI und Fernsteuerungskanal | `redeven run --mode hybrid` |
| Von Desktop verwaltete Laufzeit | `redeven run --mode desktop --desktop-managed --presentation machine --local-ui-bind localhost:23998` |
| Zugriff von einem anderen Gerät | Local UI auf Loopback belassen und Redeven Desktop, SSH-Weiterleitung oder einen sicheren Flowersec-Tunnel verwenden. |

<!-- readme-section:what-you-can-do -->
<a id="what-you-can-do"></a>

## Was du tun kannst

| Oberfläche | Funktionen |
|---|---|
| Dateien und Git | Dateien hoch- und herunterladen, direkt anzeigen und bearbeiten, ordnerbezogene Git-Änderungen, Diffs und Stash-Abläufe. |
| Terminal | Terminals mit mehreren Tabs, die in deinen Arbeitsverzeichnissen starten und demselben Laufzeit-Berechtigungsmodell folgen. |
| Monitoring | Ansichten für CPU, Arbeitsspeicher, Datenträger, Netzwerk und Prozesse aus der Endpunkt-Laufzeit. |
| Browser Editor | Von Desktop ausdrücklich eingerichtete und nach Arbeitsbereich isolierte Browser-Editor-Sitzungen. |
| Webdienste | Von der Laufzeit verwaltete Dienstregistrierung und Portweiterleitung ohne manuell erstellte SSH-Tunnel. |
| Flower und Codex | Optionale KI-Oberflächen mit von der Laufzeit geprüften Werkzeugen und lokaler Modell- und Hostkonfiguration. |
| Desktop | Nativer Starter für lokale, bei einem provider gehostete, per SSH initialisierte und gespeicherte Local UI-Umgebungen. |

<!-- readme-section:security -->
<a id="security"></a>

## Sicherheit, ohne die Funktionen in den Hintergrund zu drängen

Redeven stellt Funktionen in den Vordergrund. Die Laufzeit bleibt dennoch die Vertrauensgrenze, weil sie den tatsächlichen Host kontrolliert.

- Die Laufzeit läuft auf dem Endpunkt und hält Klartextdaten dort.
- Die Steuerungsebene stellt Bootstrap-Nutzdaten, Freigaben und unveränderliche Sitzungsmetadaten aus.
- [Flowersec](https://github.com/floegence/flowersec) überträgt verschlüsselte Bytes zwischen Client und Endpunkt-Laufzeit. Die aktuelle Laufzeitintegration ist für `flowersec-go/v0.20.2` dokumentiert.
- Wirksame Berechtigungen stammen aus serverseitig ausgestellten Sitzungsfreigaben und werden durch die lokale Berechtigungsrichtlinie begrenzt (`read`, `write`, `execute`, `admin`; keine Kategorie schließt eine andere ein).
- Lokale Konfiguration, E2EE-Material, Audit-Logs und Diagnosedaten verbleiben im Zustandsverzeichnis des Endpunkts.
- GitHub Releases bleiben die öffentliche Referenz für Binärdateien, Prüfsummen, Signaturen und OKF-Verifikationsdateien.

<!-- readme-section:documentation -->
<a id="documentation"></a>

## Dokumentation

Redeven pflegt sein Repository-Wissen in [OKF v0.1](okf/index.md). Der OKF-Korpus wird aus dem aktuellen Verhalten des Quellcodes erzeugt und für `okf.search` in die Laufzeit eingebettet.

Die maschinenlesbare Oberfläche für provider-Integrationen befindet sich in [spec/openapi/rcpp-v2.yaml](spec/openapi/rcpp-v2.yaml). Außerhalb von OKF ist gepflegtes Markdown bewusst auf `AGENTS.md`, `THIRD_PARTY_NOTICES.md`, die maßgebliche `README.md` und die in `assets/readme/locales.json` deklarierten unterstützten Übersetzungen `README.<locale>.md` beschränkt.

<!-- readme-section:for-developers -->
<a id="for-developers"></a>

## Für Entwickler

Aus dem Quellcode kompilieren, linten und verifizieren.

<details>
<summary>Aus dem Quellcode bauen</summary>

<!-- readme-section:prerequisites -->
<a id="prerequisites"></a>

### Voraussetzungen

- Go `1.26.3`
- Node.js `24`
- npm
- pnpm oder Node.js `corepack`

<!-- readme-section:build -->
<a id="build"></a>

### Build

```bash
./scripts/lint_ui.sh
./scripts/check_desktop.sh
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

<!-- readme-section:local-guardrails -->
<a id="local-guardrails"></a>

### Lokale Schutzmaßnahmen

```bash
./scripts/install_git_hooks.sh
node scripts/generate_third_party_notices.mjs --check
```

Hinweise:

- Dateien unter `internal/**/dist/` werden generiert und über Go `embed` eingebettet.
- Frontend-Dateien unter `dist` werden nicht in Git eingecheckt. Die verfolgte Ausnahme ist `okf/dist/*`, das als verifizierbare Release-Metadaten des OKF-Bundles eingecheckt bleibt.
- `THIRD_PARTY_NOTICES.md` wird aus Go-Modulen und JavaScript-Lockdateien erzeugt. Führe nach Abhängigkeitsänderungen `node scripts/generate_third_party_notices.mjs` aus und halte `--check` grün.
- `./scripts/lint_ui.sh`, `./scripts/check_desktop.sh`, `./scripts/build_assets.sh` und `go test ./...` sind die wichtigsten Prüfungen auf Quellcodeebene.
- `./scripts/dev_desktop.sh` startet Desktop aus dem aktuellen Checkout oder worktree mit einer frisch gebündelten Laufzeit.
- `cd desktop && npm run start` und `cd desktop && npm run package` bereiten `desktop/.bundle/<goos>-<goarch>/redeven` vor, bevor Electron die Desktop-Shell startet oder paketiert.

</details>

<details>
<summary>Lokaler Zustand, Release-Pfade und Fehlerbehebung</summary>

- Der Zustand der lokalen Umgebung liegt standardmäßig unter `~/.redeven/local-environment/`. Desktop und der eigenständige Laufzeitmodus verwenden außerdem gemeinsam den Profilkatalog unter `~/.redeven/catalog/`.
- GitHub Releases ist die öffentliche Referenz für versionierte CLI-Archive, Desktop-Installationsprogramme, Prüfsummen, Signaturen und OKF-Verifikationsdateien.
- Aktuelle Implementierungsdetails findest du über `okf.search` im eingebetteten OKF-Bundle oder in [okf/index.md](okf/index.md).

</details>

<!-- readme-section:license -->
<a id="license"></a>

## Lizenz

Redeven steht unter der [MIT License](LICENSE). Hinweise zu Abhängigkeiten von Drittanbietern werden in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) gepflegt. Release-Archive und Desktop-Pakete enthalten diese Dateien zusammen mit den Laufzeitartefakten.

<!-- readme-section:open-source-scope -->
<a id="open-source-scope"></a>

## Open-Source-Umfang

Dieses öffentliche Repository umfasst die Endpunkt- und Laufzeitschicht, das Verhalten von Redeven Local UI, die Desktop-Shell und den GitHub-Release-Vertrag.

Organisationsspezifische Bereitstellungsautomatisierung, Implementierungen der Steuerungsebene und standortspezifische Paketierungs-Wrapper sind bewusst nicht enthalten.
