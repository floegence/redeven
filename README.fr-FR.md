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
  <strong>Français</strong> |
  <a href="README.es-ES.md">Español</a> |
  <a href="README.pt-BR.md">Português do Brasil</a> |
  <a href="README.ru-RU.md">Русский</a>
</p>
<!-- readme-locales:end -->

<p align="center">
  <strong>Vos ordinateurs et serveurs dans un seul onglet de navigateur.</strong><br>
  Terminal, explorateur de fichiers, IDE et IA,
  <br>le tout sur votre propre matériel, avec chiffrement de bout en bout.
</p>

<p align="center">
  <a href="https://github.com/floegence/redeven/releases">Télécharger Desktop</a> |
  <a href="#quick-start">Installer la CLI</a> |
  <a href="#what-you-can-do">Fonctionnalités</a> |
  <a href="#security">Sécurité</a> |
  <a href="#documentation">Documentation</a>
</p>

<p align="center">
  <a href="https://go.dev/"><img alt="Version de Go" src="https://img.shields.io/badge/Go-1.26.3-00ADD8?style=flat-square&logo=go"></a>
  <a href="https://nodejs.org/"><img alt="Version de Node.js" src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js"></a>
  <a href="okf/index.md"><img alt="Base de connaissances OKF" src="https://img.shields.io/badge/Knowledge-OKF%20v0.1-6C3BFF?style=flat-square"></a>
  <a href="https://github.com/floegence/redeven/releases"><img alt="Versions publiées" src="https://img.shields.io/badge/Releases-GitHub-181717?style=flat-square&logo=github"></a>
</p>

<!-- readme-section:what-is-redeven -->
<a id="what-is-redeven"></a>

## Qu'est-ce que Redeven ?

Redeven est un binaire unique qui réunit vos ordinateurs et vos serveurs dans un seul onglet de navigateur. Au lieu de jongler entre terminaux SSH, explorateurs de fichiers, tableaux de bord de supervision, redirections de ports et fenêtres d'IDE, vous disposez d'un espace de travail unifié sur le matériel que vous contrôlez déjà.

Il s'exécute sur votre machine, vos serveurs distants ou tout hôte SSH accessible. Vos fichiers, processus, clés d'API et identifiants restent là où ils doivent se trouver : Redeven ne fait pas transiter vos données en clair par l'infrastructure d'un tiers.

- **Les clients se connectent à un environnement d'exécution de point de terminaison** : le navigateur, Desktop, la CLI et les sessions hébergées via SSH accèdent tous au même espace de travail géré par l'environnement d'exécution.
- **L'environnement d'exécution est la frontière de confiance** : un seul binaire Go gère les fichiers, les terminaux, la supervision, Git, le transfert des services web, la disposition Workbench, les notes, la configuration de Browser Editor, Flower ainsi que l'accès au pont Codex.
- **Le transport et les règles restent explicites** : Flowersec transporte les flux RPC et de streaming chiffrés, tandis que les autorisations de session, la politique locale de permissions, le périmètre du système de fichiers et les secrets locaux limitent les actions de chaque session.

![Vue d'ensemble de l'architecture Redeven](assets/readme/architecture-overview.png)

<!-- readme-section:quick-start -->
<a id="quick-start"></a>

## Démarrage rapide

Deux méthodes sont disponibles : Desktop, recommandé à la plupart des utilisateurs, ou la CLI.

<!-- readme-section:desktop-app -->
<a id="desktop-app"></a>

### Application Desktop

1. Téléchargez Redeven Desktop depuis [GitHub Releases](https://github.com/floegence/redeven/releases).
2. Ouvrez l'application et choisissez votre environnement : local, Provider, hôte SSH ou URL enregistrée.
3. Commencez à travailler : l'espace de travail s'ouvre automatiquement dans votre navigateur.

Pour les machines distantes, Desktop peut installer automatiquement la version correspondante de Redeven via SSH, puis connecter explicitement cet environnement d'exécution SSH géré à un environnement provider lorsque vous le demandez. Aucune configuration manuelle n'est nécessaire sur l'hôte distant.

<!-- readme-section:cli -->
<a id="cli"></a>

### CLI

```bash
# 1. Installer
curl -fsSL https://raw.githubusercontent.com/floegence/redeven/main/scripts/install.sh | sh

# 2. Exécuter
redeven run

# 3. Ouvrir http://localhost:23998 dans votre navigateur.
```

Lors de sa première exécution, `redeven run` initialise l'état local dans `~/.redeven/local-environment/` et démarre en mode local. Aucun amorçage ni aucune configuration du plan de contrôle n'est nécessaire. Local UI écoute uniquement sur `localhost:23998` et n'est disponible que depuis cet appareil ; l'accès direct depuis le LAN ou un réseau public n'est pas pris en charge. Ctrl+C arrête l'environnement d'exécution.

Pour découvrir les autres modes d'exécution et la protection locale facultative par mot de passe, exécutez `redeven help run`.

<!-- readme-section:what-you-can-do -->
<a id="what-you-can-do"></a>

## Ce que vous pouvez faire

| Surface | Fonctionnalités proposées |
|---|---|
| Fichiers et Git | Téléversement et téléchargement de fichiers, aperçu et modification en ligne, modifications Git limitées au dossier, diffs et opérations de stash. |
| Terminal | Terminaux à plusieurs onglets, ouverts dans vos répertoires de travail et soumis au même modèle de permissions d'environnement d'exécution. |
| Supervision | Vues du processeur, de la mémoire, du disque, du réseau et des processus fournies par l'environnement d'exécution du point de terminaison. |
| Browser Editor | Sessions d'éditeur dans le navigateur, configurées explicitement par Desktop et isolées par espace de travail. |
| Services web | Enregistrement de services et accès par redirection de ports gérés par l'environnement d'exécution, sans tunnel SSH écrit à la main. |
| Flower et Codex | Surfaces d'IA facultatives utilisant des outils validés par l'environnement d'exécution et une configuration locale du modèle et de l'hôte. |
| Desktop | Lanceur natif pour les environnements locaux, les environnements hébergés par un provider, ceux initialisés via SSH et les environnements Local UI enregistrés. |

<!-- readme-section:security -->
<a id="security"></a>

## La sécurité, sans éclipser les fonctionnalités

Redeven met les fonctionnalités au premier plan, mais l'environnement d'exécution reste la frontière de confiance puisqu'il contrôle l'hôte réel.

- L'environnement d'exécution réside sur le point de terminaison et y conserve les données en clair.
- Le plan de contrôle émet les charges utiles d'initialisation, les autorisations et les métadonnées de session immuables.
- [Flowersec](https://github.com/floegence/flowersec) transporte des octets chiffrés entre le client et l'environnement d'exécution du point de terminaison. L'intégration actuelle est documentée pour `flowersec-go/v0.27.0`.
- Les permissions effectives proviennent des autorisations de session émises par le serveur, limitées par la politique locale (`read`, `write`, `execute`, `admin` ; aucune catégorie n'en implique une autre).
- La configuration locale, le matériel E2EE, les journaux d'audit et les diagnostics restent dans le répertoire d'état du point de terminaison.
- GitHub Releases demeure la référence publique pour les binaires, sommes de contrôle, signatures et ressources de vérification OKF.

<!-- readme-section:documentation -->
<a id="documentation"></a>

## Documentation

Redeven conserve les connaissances maintenues du dépôt dans [OKF v0.1](okf/index.md). Le corpus OKF est produit à partir du comportement actuel du code source et intégré à l'environnement d'exécution pour `okf.search`.

L'interface d'intégration provider, lisible par machine, se trouve dans [spec/openapi/rcpp-v2.yaml](spec/openapi/rcpp-v2.yaml). En dehors d'OKF, les fichiers Markdown maintenus sont volontairement limités à `AGENTS.md`, `THIRD_PARTY_NOTICES.md`, au fichier canonique `README.md` et aux traductions `README.<locale>.md` prises en charge et déclarées dans `assets/readme/locales.json`.

<!-- readme-section:for-developers -->
<a id="for-developers"></a>

## Pour les développeurs

Exécutez la compilation, le lint et les vérifications depuis les sources.

<details>
<summary>Compiler depuis les sources</summary>

<!-- readme-section:prerequisites -->
<a id="prerequisites"></a>

### Prérequis

- Go `1.26.3`
- Node.js `24`
- npm
- pnpm ou Node.js `corepack`

<!-- readme-section:build -->
<a id="build"></a>

### Compilation

```bash
./scripts/lint_ui.sh
./scripts/check_desktop.sh
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

<!-- readme-section:local-guardrails -->
<a id="local-guardrails"></a>

### Garde-fous locaux

```bash
./scripts/install_git_hooks.sh
node scripts/generate_third_party_notices.mjs --check
```

Remarques :

- Les ressources `internal/**/dist/` sont générées puis intégrées avec Go `embed`.
- Les ressources frontend `dist` ne sont pas enregistrées dans Git. L'exception suivie est `okf/dist/*`, conservée comme métadonnées vérifiables de publication du bundle OKF.
- `THIRD_PARTY_NOTICES.md` est généré à partir des modules Go et des fichiers de verrouillage JavaScript. Exécutez `node scripts/generate_third_party_notices.mjs` après toute modification de dépendances et maintenez `--check` au vert.
- `./scripts/lint_ui.sh`, `./scripts/check_desktop.sh`, `./scripts/build_assets.sh` et `go test ./...` sont les principales vérifications au niveau du code source.
- `./scripts/dev_desktop.sh` démarre Desktop depuis le checkout ou le worktree actuel avec un environnement d'exécution fraîchement empaqueté.
- `cd desktop && npm run start` et `cd desktop && npm run package` préparent `desktop/.bundle/<goos>-<goarch>/redeven` avant qu'Electron ne démarre ou n'empaquète le shell Desktop.

</details>

<details>
<summary>État local, chemins de publication et dépannage</summary>

- L'état de l'environnement local se trouve par défaut dans `~/.redeven/local-environment/`. Desktop et le mode d'environnement d'exécution autonome partagent également le catalogue de profils sous `~/.redeven/catalog/`.
- GitHub Releases est la référence publique pour les archives CLI versionnées, programmes d'installation Desktop, sommes de contrôle, signatures et ressources de vérification OKF.
- Pour les détails d'implémentation actuels, interrogez le bundle OKF intégré avec `okf.search` ou consultez [okf/index.md](okf/index.md).

</details>

<!-- readme-section:license -->
<a id="license"></a>

## Licence

Redeven est distribué sous [MIT License](LICENSE). Les avis relatifs aux dépendances tierces sont suivis dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Les archives de publication et les paquets Desktop incluent ces fichiers avec les artefacts de l'environnement d'exécution.

<!-- readme-section:open-source-scope -->
<a id="open-source-scope"></a>

## Périmètre open source

Ce dépôt public couvre la couche de point de terminaison et d'environnement d'exécution, le comportement de Redeven Local UI, le shell Desktop et le contrat GitHub Release.

L'automatisation de déploiement propre à une organisation, les implémentations du plan de contrôle et les outils d'empaquetage spécifiques à chaque site sont volontairement hors périmètre.
