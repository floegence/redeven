---
id: K-WEB-001
version: 1
title: Env App UI binds floe-webapp, floeterm web terminal, and flowersec web SDKs
status: stable
owners:
  - frontend
tags:
  - dependencies
  - ui
source_card_id: K-WEB-001
---

## Conclusion

The embedded Env App UI composes floe-webapp, floeterm terminal web bindings, and flowersec web libraries as first-class frontend dependencies.

## Mechanism

The UI package declares floe-webapp core/protocol, floeterm terminal web, and flowersec core dependencies, then ships them through the Vite build embedded into the agent.

## Boundaries

Removing or unsafely changing these packages can break protocol rendering, terminal interop, or secure channel behavior in the UI.

## Evidence

- redeven-agent:internal/envapp/ui_src/package.json:13 - floe-webapp-core is a declared dependency.
- redeven-agent:internal/envapp/ui_src/package.json:14 - floe-webapp-protocol is a declared dependency.
- redeven-agent:internal/envapp/ui_src/package.json:15 - floeterm terminal web package is a declared dependency.
- redeven-agent:internal/envapp/ui_src/package.json:16 - flowersec core package is a declared dependency.

## Invalid Conditions

This card becomes invalid if Env App UI no longer uses these dependency families for protocol and terminal rendering.
