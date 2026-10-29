<p align="center">
  <img src="assets/brand/redeven/png/app-icon-256.png" alt="Redeven" width="72">
</p>

# Redeven

**Where machines become workspaces.**

Vos ordinateurs et serveurs réunis avec vos fichiers, terminaux, Git et IA. Travaillez dans le navigateur. Gardez vos projets sur vos machines.

**[Site officiel](https://redeven.com)** · **[Essayer la démo](https://redeven.com/#product)** · [Télécharger Desktop](https://redeven.com/download) · [Documentation](https://redeven.com/docs)

![Redeven Workbench en cours d’utilisation avec fichiers réels, terminal, notes et suivi du système](assets/readme/runtime-workbench.webp)

<!-- readme-section:work -->
<a id="work"></a>

## Tout pour votre prochaine idée

- **Un espace à votre façon.** Disposez fichiers, terminaux, notes et outils de suivi sur Workbench.
- **De l’idée au code qui fonctionne.** Examinez les modifications, ouvrez votre éditeur et lancez des services web sur la même machine.
- **Avancez avec Flower.** Un assistant IA qui utilise les outils de votre environnement avec votre autorisation.

![Le navigateur de fichiers de Redeven affiche le code source du projet dans une instance active](assets/readme/runtime-files.webp)

Captures d’une instance de Redeven exécutée dans Chrome, avec les fichiers source du projet et une véritable session de terminal.

<!-- readme-section:start -->
<a id="start"></a>

## Choisissez votre point de départ

![Desktop réunit un centre d’environnements et un moteur local ; Web Center fonctionne indépendamment sur votre serveur ; chaque machine cible conserve son propre moteur](assets/readme/ways-to-connect.svg)

- **[Desktop](https://redeven.com/docs/download-desktop)** — le point de départ le plus simple sur macOS et Linux, avec un moteur local intégré et des connexions distantes guidées.
- **[Moteur](https://redeven.com/docs/download-runtime)** — exécutez-le directement sur un ordinateur ou un serveur et ouvrez son espace de travail dans votre navigateur.
- **[Web Center](https://redeven.com/docs/environment-center)** — hébergez un répertoire privé d’environnements pour un administrateur. Ouvrez les moteurs autorisés dans un navigateur, sans Desktop. Consultez le guide pour la disponibilité des paquets et l’installation.

Besoin d’un accès partagé avec des comptes ? Découvrez [Redeven Cloud](https://redeven.com/docs/control-plane-providers).

Fichiers et processus restent sur la machine cible. Flowersec protège les sessions distantes ; Web Center est un proxy de confiance qui peut voir le trafic applicatif. [Comprendre le modèle de sécurité](https://redeven.com/docs/security-architecture).

<!-- readme-section:documentation -->
<a id="documentation"></a>

## Pour aller plus loin

[Premiers pas](https://redeven.com/docs/getting-started) · [Guide de déploiement](okf/operations/web-center-deployment.md) · [Versions](https://github.com/floegence/redeven/releases) · [Documentation du code · OKF v0.2](okf/index.md)

<details>
<summary>Compiler depuis les sources</summary>

Go `1.27.3` · Node.js `26.7.0` · npm / pnpm

[![Go](https://img.shields.io/badge/Go-1.27.3-00ADD8?style=flat-square&logo=go)](https://go.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-26.7.0-339933?style=flat-square&logo=node.js)](https://nodejs.org/)

```bash
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

Consultez le [guide du dépôt](AGENTS.md) pour les exigences de développement et de validation.

</details>

<!-- readme-section:license -->
<a id="license"></a>

## Open source

[Licence MIT](LICENSE). Ce dépôt contient le moteur, Desktop et Web Center. [Mentions des composants tiers](THIRD_PARTY_NOTICES.md).

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
