# Env App UI (Agent-Bundled)

This folder contains the **source code** for the agent-bundled Env App UI:

- Build output: `internal/envapp/ui/dist/env/*`
- Served by the agent local gateway under: `/_redeven_proxy/env/*`
- Delivered to the browser over Flowersec E2EE (runtime mode) when running the sandbox origin:
  - `https://env-<env_id>.<region>.<base-sandbox-domain>/_redeven_boot/`
- Cross-surface product flows such as `File Browser -> Open in Terminal` and `Terminal -> Browse files` are implemented here through Env App shell/context orchestration rather than in the region frontend.

Notes:

- The Redeven web app that opens the Env App stays outside this repository.
- This Env App contains the **env details** features (Deck/Terminal/Monitor/File Browser/Codespaces/Ports/Flower).
- File Browser uses Monaco for both preview and edit when the shared editor supports the file language; the Shiki preview surface is kept only for unsupported code languages and fallback scenarios such as truncated previews or Monaco runtime failures.
- Supported code previews remount Monaco when the user enters Edit mode so the writable editor never inherits stale read-only lifecycle state from preview mode.

## Verification

From this directory:

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run test
pnpm run test:browser
pnpm run typecheck
pnpm run build
```

The build output is written to `../ui/dist/`.
