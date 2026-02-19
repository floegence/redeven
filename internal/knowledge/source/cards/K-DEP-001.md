---
id: K-DEP-001
version: 1
title: Agent runtime depends on Flowersec transport and Floeterm terminal engine
status: stable
owners:
  - backend
tags:
  - architecture
  - dependencies
source_card_id: K-DEP-001
---

## Conclusion

Redeven Agent runtime is coupled to Flowersec for transport/control primitives and Floeterm for terminal session orchestration.

## Mechanism

Go module dependencies pin both SDKs, while runtime packages import Flowersec endpoint/rpc layers and Floeterm manager APIs for terminal lifecycle handling.

## Boundaries

Upgrading either dependency without validating protocol and runtime behavior can break control/data session compatibility.

## Evidence

- redeven-agent:go.mod:7 - Floeterm terminal-go dependency is pinned in the runtime module.
- redeven-agent:go.mod:8 - Flowersec-go dependency is pinned in the runtime module.
- redeven-agent:internal/agent/agent.go:20 - Agent runtime imports Flowersec client and endpoint packages.
- redeven-agent:internal/terminal/manager.go:16 - Terminal manager imports Floeterm terminal-go manager.

## Invalid Conditions

This card becomes invalid if runtime terminal or transport stacks stop depending on these libraries or move to a different integration contract.
