# Code App UI (Agent-Bundled)

This folder contains the **source code** for the minimal UI assets embedded in the agent binary:

- `internal/codeapp/ui/dist/inject.js`

They are served by the agent local gateway under `/_redeven_proxy/*`, then delivered to the browser over Flowersec E2EE via `flowersec-proxy/http1`.

## Why we embed built assets

We embed the **built** artifacts (not the sources) to keep the shipped agent self-contained and to ensure the UI version is strictly coupled to the agent version.

## Build

From this directory:

```bash
npm ci
npm run lint
npm run typecheck
npm run build
```

The build output is written to `../ui/dist/`.
