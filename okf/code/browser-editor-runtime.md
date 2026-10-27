---
type: Runtime Contract
title: Browser Editor runtime
description: Code App serves Browser Editor codespaces through the local app server and managed code workspace engine APIs.
tags: [code-app, browser-editor, local-ui, desktop]
quality_exception: Cross-surface Browser Editor contract spanning Code App runtime state, Desktop transfer, Env App orchestration, remote download validation, and codespace navigation security.
timestamp: 2026-09-29T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Browser Editor support is owned by the Code App app server. Codespaces are opened through Local UI `/cs/<id>/` routes or through remote `cs-*` sandbox hosts, while Desktop and Env App can prepare or update managed Browser Editor runtime versions through code workspace engine APIs.

# Contract

## Mechanism
The Code App app server backend owns codespace lifecycle, port resolution, managed runtime status, setup operations, Desktop-transfer chunks, completion, version selection, version removal, and operation cancellation. Only one setup operation may run at a time, an accepted operation id cannot be reused during the RuntimeManager lifetime, and stale chunk, completion, cancellation, or progress updates cannot terminate or overwrite a different operation.

External system-browser and ordinary browser opens retain the existing Local UI or remote launcher flow.

# Boundaries

Opening or managing Browser Editor is not just a static file route. The session-scoped Desktop bridge values are transport bootstrap inputs for the current isolated app origin; they do not grant broader runtime permissions or replace controller source, origin, and capability validation.

# Evidence

- `redeven:internal/codeapp/appserver/server.go:80` - App server backend owns codespace start, stop, delete, and port resolution.

- `redeven:internal/localui/localui.go:132` - Local UI mounts `/cs/` for codespace routes.
