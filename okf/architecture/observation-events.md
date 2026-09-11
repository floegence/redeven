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

# Evidence

- `redeven:internal/ai/run.go` - target tool dispatch and result provenance.
- `redeven:internal/flower_ui/src/flowerLiveMapper.ts` - canonical Activity renderer mapping.
- `redeven:internal/flower_ui/src/flowerActivityPresentation.ts` - computer and browser presentation handlers.
