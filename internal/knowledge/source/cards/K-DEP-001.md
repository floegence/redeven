---
id: K-DEP-001
version: 2
title: Runtime transport rides Flowersec sessions while terminal lifecycle rides Floeterm managers
status: stable
owners:
  - backend
tags:
  - architecture
  - dependencies
  - terminal
source_card_id: K-DEP-001
---

## Conclusion

Redeven runtime builds control and data sessions on Flowersec client and endpoint primitives, while terminal lifecycle inside the runtime is delegated to Floeterm's terminal-go manager.

## Mechanism

Redeven pins released `flowersec-go` and `terminal-go` versions in `go.mod`. The agent connects the control channel through `fsclient.ConnectDirect`, opens data sessions through `endpoint.ConnectTunnel`, and wraps `termgo.NewManager` so terminal sessions, PTY activation, and lifecycle bookkeeping stay inside Floeterm's manager abstraction.

## Boundaries

Compatibility depends on these transport and terminal interfaces staying aligned across released versions. Replacing or bypassing them can break control and data channel behavior, stream semantics, or terminal session lifecycle.

## Evidence

- redeven:go.mod:8 - Redeven pins floeterm terminal-go in the runtime module.
- redeven:go.mod:9 - Redeven pins flowersec-go in the runtime module.
- redeven:internal/agent/agent.go:20 - Agent imports Flowersec client, endpoint, proxy, and RPC packages.
- redeven:internal/agent/agent.go:380 - The control channel connects through fsclient.ConnectDirect.
- redeven:internal/agent/agent.go:688 - Runtime data sessions connect through endpoint.ConnectTunnel.
- redeven:internal/terminal/manager.go:14 - Runtime terminal manager wraps floeterm terminal-go plus Flowersec RPC types.
- redeven:internal/terminal/manager.go:98 - Runtime instantiates termgo.NewManager with Redeven shell and logging config.
- floeterm:terminal-go/manager.go:12 - Floeterm exposes the terminal manager constructor Redeven embeds.
- floeterm:terminal-go/manager.go:43 - Floeterm manages dormant logical terminal sessions before PTY activation.
- flowersec:flowersec-go/client/client.go:17 - Flowersec client sessions expose RPC, stream opening, ping, and close semantics.
- flowersec:flowersec-go/endpoint/session.go:19 - Flowersec endpoint sessions expose ServeStreams and OpenStream over the secure mux.

## Invalid Conditions

This card becomes invalid if runtime transport no longer uses Flowersec client and endpoint session abstractions or terminal lifecycle moves off Floeterm manager semantics.
