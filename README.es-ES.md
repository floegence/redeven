<p align="center">
  <img src="assets/brand/redeven/png/app-icon-256.png" alt="Redeven" width="72">
</p>

# Redeven

**Where machines become workspaces.**

Tus ordenadores y servidores, con archivos, terminales, Git e IA en un solo lugar. Trabaja desde el navegador. Tus proyectos permanecen en tus máquinas.

**[Web oficial](https://redeven.com)** · **[Probar la demo](https://redeven.com/#product)** · [Descargar Desktop](https://redeven.com/download) · [Documentación](https://redeven.com/docs)

![Redeven Workbench en funcionamiento con archivos reales, terminal, notas y monitorización del sistema](assets/readme/runtime-workbench.webp)

<!-- readme-section:work -->
<a id="work"></a>

## Todo para tu próxima idea

- **Un espacio para tu forma de trabajar.** Organiza archivos, terminales, notas y monitorización en Workbench.
- **De la idea al código en funcionamiento.** Revisa cambios, abre tu editor y ejecuta servicios web en la misma máquina.
- **Trabaja con Flower.** Un asistente de IA que utiliza las herramientas de tu entorno con tu permiso.

![El explorador de archivos de Redeven muestra el código fuente del proyecto en una instancia en ejecución](assets/readme/runtime-files.webp)

Capturas de una instancia de Redeven en ejecución en Chrome, con los archivos fuente del proyecto y una sesión de terminal real.

<!-- readme-section:start -->
<a id="start"></a>

## Elige tu punto de partida

![Desktop reúne un centro de entornos y un motor local; Web Center se ejecuta de forma independiente en tu servidor; cada máquina de destino conserva su propio motor](assets/readme/ways-to-connect.svg)

- **[Desktop](https://redeven.com/docs/download-desktop)** — la forma más sencilla de empezar en macOS y Linux, con un motor local integrado y conexiones remotas guiadas.
- **[Motor](https://redeven.com/docs/download-runtime)** — ejecútalo directamente en un ordenador o servidor y abre su espacio de trabajo en el navegador.
- **[Web Center](https://redeven.com/docs/environment-center)** — aloja un directorio privado de entornos para un administrador. Abre motores autorizados desde el navegador, sin Desktop. Consulta la disponibilidad de paquetes y la configuración en la guía.

¿Necesitas acceso compartido mediante cuentas? Descubre [Redeven Cloud](https://redeven.com/docs/control-plane-providers).

Los archivos y procesos permanecen en la máquina de destino. Flowersec protege las sesiones remotas; Web Center es un proxy de confianza que puede ver el tráfico de las aplicaciones. [Conoce el modelo de seguridad](https://redeven.com/docs/security-architecture).

<!-- readme-section:documentation -->
<a id="documentation"></a>

## Explora más

[Primeros pasos](https://redeven.com/docs/getting-started) · [Guía de despliegue](okf/operations/web-center-deployment.md) · [Versiones](https://github.com/floegence/redeven/releases) · [Conocimiento del código · OKF v0.2](okf/index.md)

<details>
<summary>Compilar desde el código fuente</summary>

Go `1.27.3` · Node.js `26.7.0` · npm / pnpm

[![Go](https://img.shields.io/badge/Go-1.27.3-00ADD8?style=flat-square&logo=go)](https://go.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-26.7.0-339933?style=flat-square&logo=node.js)](https://nodejs.org/)

```bash
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

Consulta la [guía del repositorio](AGENTS.md) para conocer los requisitos de desarrollo y validación.

</details>

<!-- readme-section:license -->
<a id="license"></a>

## Código abierto

[Licencia MIT](LICENSE). Este repositorio contiene el motor, Desktop y Web Center. [Avisos de terceros](THIRD_PARTY_NOTICES.md).

<!-- readme-locales:start -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.zh-TW.md">繁體中文</a> |
  <a href="README.ja-JP.md">日本語</a> |
  <a href="README.ko-KR.md">한국어</a> |
  <a href="README.de-DE.md">Deutsch</a> |
  <a href="README.fr-FR.md">Français</a> |
  <strong>Español</strong> |
  <a href="README.pt-BR.md">Português do Brasil</a> |
  <a href="README.ru-RU.md">Русский</a>
</p>
<!-- readme-locales:end -->
