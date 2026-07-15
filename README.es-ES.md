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
  <strong>Español</strong> |
  <a href="README.pt-BR.md">Português do Brasil</a> |
  <a href="README.ru-RU.md">Русский</a>
</p>
<!-- readme-locales:end -->

<p align="center">
  <strong>Tus ordenadores y servidores, en una sola pestaña del navegador.</strong><br>
  Terminal, explorador de archivos, IDE e IA,
  <br>todo en tu propio hardware y con cifrado de extremo a extremo.
</p>

<p align="center">
  <a href="https://github.com/floegence/redeven/releases">Descargar Desktop</a> |
  <a href="#quick-start">Instalar la CLI</a> |
  <a href="#what-you-can-do">Funciones</a> |
  <a href="#security">Seguridad</a> |
  <a href="#documentation">Documentación</a>
</p>

<p align="center">
  <a href="https://go.dev/"><img alt="Versión de Go" src="https://img.shields.io/badge/Go-1.26.3-00ADD8?style=flat-square&logo=go"></a>
  <a href="https://nodejs.org/"><img alt="Versión de Node.js" src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js"></a>
  <a href="okf/index.md"><img alt="Conocimiento OKF" src="https://img.shields.io/badge/Knowledge-OKF%20v0.1-6C3BFF?style=flat-square"></a>
  <a href="https://github.com/floegence/redeven/releases"><img alt="Versiones publicadas" src="https://img.shields.io/badge/Releases-GitHub-181717?style=flat-square&logo=github"></a>
</p>

<!-- readme-section:what-is-redeven -->
<a id="what-is-redeven"></a>

## ¿Qué es Redeven?

Redeven es un único binario que reúne tus ordenadores y servidores en una pestaña del navegador. En lugar de alternar entre terminales SSH, exploradores de archivos, paneles de supervisión, reenvíos de puertos y ventanas del IDE, obtienes un espacio de trabajo unificado en el hardware que ya controlas.

Se ejecuta en tu equipo, en servidores remotos o en cualquier host SSH accesible. Tus archivos, procesos, claves de API y credenciales permanecen donde deben estar: Redeven no mueve tus datos en texto claro a través de infraestructura ajena.

- **Los clientes se conectan a un entorno de ejecución del endpoint**: el navegador, Desktop, la CLI y las sesiones alojadas mediante SSH entran en el mismo espacio de trabajo administrado por el entorno de ejecución.
- **El entorno de ejecución es el límite de confianza**: un único binario de Go gestiona archivos, terminales, supervisión, Git, reenvío de servicios web, la disposición de Workbench, notas, la configuración de Browser Editor, Flower y el acceso al puente de Codex.
- **El transporte y las políticas se mantienen explícitos**: Flowersec transporta el tráfico RPC y de streams cifrado, mientras que las concesiones de sesión, la política local de permisos, el alcance del sistema de archivos y los secretos locales limitan lo que puede hacer cada sesión.

![Resumen de la arquitectura de Redeven](assets/readme/architecture-overview.png)

<!-- readme-section:quick-start -->
<a id="quick-start"></a>

## Inicio rápido

Hay dos formas de empezar: Desktop, recomendado para la mayoría de usuarios, o la CLI.

<!-- readme-section:desktop-app -->
<a id="desktop-app"></a>

### Aplicación Desktop

1. Descarga Redeven Desktop desde [GitHub Releases](https://github.com/floegence/redeven/releases).
2. Abre la aplicación y elige tu entorno: local, Provider, host SSH o una URL guardada.
3. Empieza a trabajar: el espacio de trabajo se abre automáticamente en el navegador.

Para equipos remotos, Desktop puede instalar automáticamente la versión correspondiente de Redeven mediante SSH y, cuando lo elijas, conectar explícitamente ese entorno de ejecución SSH administrado a un entorno de provider. No es necesario configurar manualmente el host remoto.

<!-- readme-section:cli -->
<a id="cli"></a>

### CLI

```bash
# 1. Instalar
curl -fsSL https://raw.githubusercontent.com/floegence/redeven/main/scripts/install.sh | sh

# 2. Inicializar una vez, leyendo el ticket desde un archivo de secretos protegido
redeven bootstrap \
  --provider-origin https://<your-provider> \
  --controlplane https://<your-access-point> \
  --env-id <env_public_id> \
  --bootstrap-ticket-file /run/secrets/redeven-bootstrap-ticket

# 3. Ejecutar
redeven run --mode hybrid

# 4. Abrir http://localhost:23998 en el navegador.
```

La inicialización escribe los metadatos no secretos del entorno local en `~/.redeven/local-environment/config.json` y las credenciales del entorno de ejecución en el archivo con permisos restringidos `~/.redeven/local-environment/secrets.json`. Cada usuario del sistema operativo tiene una única identidad de entorno local, vinculada a un solo entorno de provider a la vez. Los flujos de Desktop y navegador usan el mismo contrato de ticket de un solo uso.

Para realizar una configuración interactiva única, sustituye `--bootstrap-ticket-file ...` por `--bootstrap-ticket-stdin`. Redeven solicitará el ticket sin mostrarlo. Cuando stdin sea una tubería o una redirección, la misma opción leerá el ticket directamente sin mostrar ningún mensaje.

Los sistemas de automatización, gestores de secretos, ejecutores de CI y orquestadores de contenedores pueden inyectar directamente `REDEVEN_BOOTSTRAP_TICKET` y `REDEVEN_LOCAL_UI_PASSWORD`. Las variables de entorno siguen siendo observables por los procesos del mismo usuario, los depuradores y la plataforma host. Para uso interactivo, es preferible emplear entrada sin eco, stdin o archivos de secretos protegidos.

Los terminales interactivos utilizan de forma predeterminada la presentación enriquecida del entorno de ejecución de Redeven: una marca de caracteres animada y compacta, detalles de versión y protocolo, recuentos de sesiones y cargas de trabajo activas, URL de Local UI y del entorno, seguimiento real de los logs del entorno de ejecución y paneles de advertencias y errores que permiten actuar. Usa las flechas para moverte entre el plano de control, las sesiones y los logs. Pulsa Intro en Sesiones para abrir una vista filtrable de las sesiones activas, en Logs para ampliar el registro completo y en Plano de control para conectar, desconectar o abrir los campos de inicialización. Esc permite volver y Ctrl+C detiene el entorno de ejecución. Los shells no interactivos vuelven al texto sin formato. Los inicios administrados por Desktop usan el contrato de presentación para máquinas con informes de inicio estructurados, en lugar de la interfaz de terminal.

**Resumen de modos de ejecución:**

| Objetivo | Comando |
|---|---|
| Solo Local UI en este dispositivo | `redeven run --mode local` |
| Local UI y canal de control remoto | `redeven run --mode hybrid` |
| Entorno de ejecución administrado por Desktop | `redeven run --mode desktop --desktop-managed --presentation machine --local-ui-bind localhost:23998` |
| Acceso desde otro dispositivo | Mantén Local UI en la interfaz de bucle local y usa Redeven Desktop, reenvío SSH o un túnel seguro de Flowersec. |

<!-- readme-section:what-you-can-do -->
<a id="what-you-can-do"></a>

## Qué puedes hacer

| Superficie | Funciones disponibles |
|---|---|
| Archivos y Git | Subida y descarga de archivos, vista previa y edición en línea, cambios de Git limitados por carpeta, diferencias y flujos de stash. |
| Terminal | Terminales con varias pestañas que parten de tus directorios de trabajo y usan el mismo modelo de permisos del entorno de ejecución. |
| Monitor | Vistas de CPU, memoria, disco, red y procesos procedentes del entorno de ejecución del endpoint. |
| Browser Editor | Sesiones del editor en el navegador configuradas explícitamente por Desktop y aisladas por espacio de trabajo. |
| Servicios web | Registro de servicios y acceso con reenvío de puertos administrados por el entorno de ejecución, sin túneles SSH escritos a mano. |
| Flower y Codex | Superficies de IA opcionales que usan herramientas validadas por el entorno de ejecución y configuración local del modelo y del host. |
| Desktop | Iniciador nativo para entornos locales, entornos alojados por un provider, entornos inicializados mediante SSH y entornos de Local UI guardados. |

<!-- readme-section:security -->
<a id="security"></a>

## Seguridad sin restar protagonismo

Redeven da prioridad a las funciones, pero el entorno de ejecución sigue siendo el límite de confianza porque controla el host real.

- El entorno de ejecución reside en el endpoint y mantiene allí los datos en texto claro.
- El plano de control emite cargas de inicialización, concesiones y metadatos de sesión inmutables.
- [Flowersec](https://github.com/floegence/flowersec) transporta bytes cifrados entre el cliente y el entorno de ejecución del endpoint. La integración actual está documentada para `flowersec-go/v0.20.2`.
- Los permisos efectivos proceden de concesiones de sesión emitidas por el servidor y quedan limitados por la política local (`read`, `write`, `execute`, `admin`; ninguna categoría implica otra).
- La configuración local, el material E2EE, los registros de auditoría y los diagnósticos permanecen en el directorio de estado del endpoint.
- GitHub Releases sigue siendo la fuente pública de referencia para binarios, sumas de comprobación, firmas y recursos de verificación de OKF.

<!-- readme-section:documentation -->
<a id="documentation"></a>

## Documentación

Redeven mantiene el conocimiento del repositorio en [OKF v0.1](okf/index.md). El corpus de OKF se genera a partir del comportamiento actual del código fuente y se integra en el entorno de ejecución para `okf.search`.

La superficie de integración con provider legible por máquinas se encuentra en [spec/openapi/rcpp-v2.yaml](spec/openapi/rcpp-v2.yaml). Fuera de OKF, los archivos Markdown mantenidos se limitan deliberadamente a `AGENTS.md`, `THIRD_PARTY_NOTICES.md`, el archivo canónico `README.md` y las traducciones compatibles `README.<locale>.md` declaradas en `assets/readme/locales.json`.

<!-- readme-section:for-developers -->
<a id="for-developers"></a>

## Para desarrolladores

Compila, ejecuta el lint y verifica el proyecto desde el código fuente.

<details>
<summary>Compilar desde el código fuente</summary>

<!-- readme-section:prerequisites -->
<a id="prerequisites"></a>

### Requisitos previos

- Go `1.26.3`
- Node.js `24`
- npm
- pnpm o Node.js `corepack`

<!-- readme-section:build -->
<a id="build"></a>

### Compilación

```bash
./scripts/lint_ui.sh
./scripts/check_desktop.sh
./scripts/build_assets.sh
go build -o redeven ./cmd/redeven
```

<!-- readme-section:local-guardrails -->
<a id="local-guardrails"></a>

### Protecciones locales

```bash
./scripts/install_git_hooks.sh
node scripts/generate_third_party_notices.mjs --check
```

Notas:

- Los recursos `internal/**/dist/` se generan y se integran mediante Go `embed`.
- Los recursos frontend de `dist` no se registran en Git. La excepción versionada es `okf/dist/*`, que permanece en el repositorio como metadatos verificables de publicación del paquete OKF.
- `THIRD_PARTY_NOTICES.md` se genera a partir de módulos Go y archivos de bloqueo de JavaScript. Ejecuta `node scripts/generate_third_party_notices.mjs` después de cambiar dependencias y mantén `--check` en verde.
- `./scripts/lint_ui.sh`, `./scripts/check_desktop.sh`, `./scripts/build_assets.sh` y `go test ./...` son las principales comprobaciones a nivel de código fuente.
- `./scripts/dev_desktop.sh` inicia Desktop desde el checkout o worktree actual con un entorno de ejecución recién empaquetado.
- `cd desktop && npm run start` y `cd desktop && npm run package` preparan `desktop/.bundle/<goos>-<goarch>/redeven` antes de que Electron inicie o empaquete el shell de Desktop.

</details>

<details>
<summary>Estado local, rutas de publicación y resolución de problemas</summary>

- El estado del entorno local se guarda de forma predeterminada en `~/.redeven/local-environment/`. Desktop y el modo independiente del entorno de ejecución también comparten el catálogo de perfiles en `~/.redeven/catalog/`.
- GitHub Releases es la fuente pública de referencia para los archivos tar versionados de la CLI, los instaladores de Desktop, las sumas de comprobación, las firmas y los recursos de verificación de OKF.
- Para consultar detalles actuales de implementación, busca en el paquete OKF integrado con `okf.search` o revisa [okf/index.md](okf/index.md).

</details>

<!-- readme-section:license -->
<a id="license"></a>

## Licencia

Redeven se distribuye bajo la [MIT License](LICENSE). Los avisos de dependencias de terceros se mantienen en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Los archivos comprimidos de las versiones y los paquetes de Desktop incluyen estos archivos junto a los artefactos del entorno de ejecución.

<!-- readme-section:open-source-scope -->
<a id="open-source-scope"></a>

## Alcance del código abierto

Este repositorio público cubre la capa de endpoint y entorno de ejecución, el comportamiento de Redeven Local UI, el shell de Desktop y el contrato de GitHub Release.

La automatización de despliegue específica de cada organización, las implementaciones del plano de control y los envoltorios de empaquetado específicos de cada sitio quedan deliberadamente fuera del alcance.
