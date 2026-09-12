---
type: Architecture Contract
title: Observation and target action events
description: Publish computer and browser action progress through the canonical Flower workspace stream while keeping media ephemeral and target-scoped.
tags: [architecture, observation, flower, computer-use]
timestamp: 2026-09-11T00:00:00Z
---
# Summary

Target actions are ordinary Flower tool observations. The workspace stream remains the only lifecycle and replay channel; screenshot descriptors are canonical keyframes, while short-lived live frames are target-scoped media and may be dropped without changing thread state.

# Contract

An action publishes running, result, and error observations with tool ID, target ID, execution location, approval state, action summary, and attachment descriptor. The UI reads these events through the existing stream and resolves screenshots through the canonical attachment preview path. It must not open a second lifecycle SSE connection, poll for action state, or infer a target from a browser window.

# Boundaries

Redeven runtime owns action execution and provenance; Flower owns rendering and
user controls. The canonical workspace stream is the only durable lifecycle
channel. Live frames are ephemeral target-scoped media and must not become
timeline events, replay state, or an alternate source of target authority.

# Evidence

- `redeven:internal/ai/run.go` - target tool dispatch and result provenance.
- `redeven:internal/flower_ui/src/flowerLiveMapper.ts` - canonical Activity renderer mapping.
- `redeven:internal/flower_ui/src/flowerActivityPresentation.ts` - computer and browser presentation handlers.
