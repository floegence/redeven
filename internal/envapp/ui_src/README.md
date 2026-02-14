# Env App UI (Agent-Bundled)

This folder contains the **source code** for the agent-bundled Env App UI:

- Build output: `internal/envapp/ui/dist/env/*`
- Served by the agent local gateway under: `/_redeven_proxy/env/*`
- Delivered to the browser over Flowersec E2EE (runtime mode) when running the sandbox origin:
  - `https://env-<env_id>.<region>.<base-domain>/_redeven_boot/`

Notes:

- The Region Portal (environment list) stays in the `redeven/` repo (`frontend/region/`).
- This Env App contains the **env details** features (Deck/Terminal/Monitor/File Browser/Codespaces/Ports/Flower).

## Build

From this directory:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```

The build output is written to `../ui/dist/`.
