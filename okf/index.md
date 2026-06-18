---
okf_version: "0.1"
---

# Redeven OKF Bundle

This top-level OKF corpus is the maintained repository knowledge surface for the current Redeven implementation. It is authored from current source code, generated contracts, and release automation rather than from removed product documents.

## Architecture

- [Runtime startup presentation](architecture/runtime-startup-presentation.md) - Structured startup events, renderer modes, and Desktop readiness reports.
- [Local UI surface](architecture/local-ui-surface.md) - Browser entrypoints, access gate, direct sessions, and Env App proxying.
- [Runtime Service snapshot](architecture/runtime-service-snapshot.md) - Desktop/runtime compatibility, open readiness, capabilities, and bindings.
- [Runtime session permission gates](architecture/runtime-session-permission-gates.md) - Runtime validation and local permission clamping before sessions open.
- [Runtime transport dependencies](architecture/runtime-transport-dependencies.md) - Flowersec and Floeterm dependency boundaries.
- [Env App upstream web dependencies](architecture/env-app-upstream-web-dependencies.md) - Published web package contracts consumed by Env App.

## Security

- [Permission policy and filesystem scope](security/permission-policy-and-filesystem-scope.md) - Local caps and directory-level file access policy.

## Desktop

- [Desktop runtime bridge](desktop/desktop-runtime-bridge.md) - Desktop-managed Local UI launches, runtime-control, and startup probing.

## Gateway

- [Gateway service](gateway/gateway-service.md) - Standalone Gateway binary, managed service lifecycle, and Desktop bridge.

## Code

- [Browser Editor runtime](code/browser-editor-runtime.md) - Code App app server, codespace proxying, and managed Browser Editor setup.

## UI

- [Workbench interaction contracts](ui/workbench-interaction-contracts.md) - Wheel, text selection, and action-surface ownership contracts.
- [Flower turn launcher](ui/flower-turn-launcher.md) - Contextual first-turn Ask Flower launchers and host handoff responsibilities.

## AI

- [AI tool runtime](ai/ai-tool-runtime.md) - Builtin tool registry, permission checks, and activity projection.
- [Prompt pack user context](ai/prompt-pack-context.md) - Ask Flower launcher context normalization and prompt-pack rendering.
- [Redeven environment operations](ai/redeven-env-operations.md) - Product boundary for Flower and automation environment lifecycle requests.
- [OKF bundle lifecycle](ai/okf-bundle-lifecycle.md) - OKF source validation, deterministic artifacts, and runtime embedding.
- [OKF search tool](ai/okf-search-tool.md) - Read-only repository knowledge lookup over the embedded OKF bundle.

## Protocol

- [Gateway v1 protocol](protocol/gateway-v1-protocol.md) - OpenAPI source contract for Gateway HTTP JSON endpoints, auth, envelopes, and Desktop behavior boundaries.
- [RCPP v2 provider API](protocol/rcpp-v2-provider-api.md) - Provider discovery, auth, environment catalog, health, bootstrap, and launch data.

## Release

- [CI and release gates](release/ci-and-release-gates.md) - Local/CI checks and release artifact contracts.
- [OKF release assets](release/okf-release-assets.md) - Public release verification files for the embedded OKF bundle.
