# Code App UI (Runtime-Bundled)

This folder contains the **source code** for the minimal UI assets embedded in the runtime binary:

- `internal/codeapp/ui/dist/inject.js`

They are served by the local runtime gateway under `/_redeven_proxy/*`, then delivered to the browser over Flowersec E2EE via `flowersec-proxy/http1`.

## Why we embed built assets

We embed the **built** artifacts (not the sources) to keep the shipped runtime self-contained and to ensure the UI version is strictly coupled to the runtime version.

## Build

From this directory:

```bash
npm ci
npm run lint
npm run typecheck
npm run build
```

The build output is written to `../ui/dist/`.
