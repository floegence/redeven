---
type: Runtime Contract
title: Runtime transport dependencies
description: Runtime transport uses Flowersec sessions while terminal lifecycle is delegated to Floeterm managers.
tags: [architecture, dependencies, terminal]
timestamp: 2026-06-17T00:00:00Z
---

Redeven runtime builds control and data sessions on Flowersec client and endpoint primitives, while terminal lifecycle inside the runtime is delegated to Floeterm's terminal-go manager.

# Mechanism

Redeven pins released `flowersec-go` and `terminal-go` versions in `go.mod`. The agent connects the control channel through `fsclient.ConnectDirect`, opens data sessions through `endpoint.ConnectTunnel`, and wraps `termgo.NewManager` so terminal sessions, PTY activation, and lifecycle bookkeeping stay inside Floeterm's manager abstraction.

# Boundaries

Compatibility depends on these transport and terminal interfaces staying aligned across released versions. Replacing or bypassing them can break control and data channel behavior, stream semantics, or terminal session lifecycle.

# Citations

[1] redeven:go.mod:8 - Redeven pins floeterm terminal-go in the runtime module.
[2] redeven:go.mod:9 - Redeven pins flowersec-go in the runtime module.
[3] redeven:internal/agent/agent.go:20 - Agent imports Flowersec client, endpoint, proxy, and RPC packages.
[4] redeven:internal/agent/agent.go:380 - The control channel connects through fsclient.ConnectDirect.
[5] redeven:internal/agent/agent.go:688 - Runtime data sessions connect through endpoint.ConnectTunnel.
[6] redeven:internal/terminal/manager.go:14 - Runtime terminal manager wraps floeterm terminal-go plus Flowersec RPC types.
[7] redeven:internal/terminal/manager.go:98 - Runtime instantiates termgo.NewManager with Redeven shell and logging config.
[8] floeterm:terminal-go/manager.go:12 - Floeterm exposes the terminal manager constructor Redeven embeds.
[9] floeterm:terminal-go/manager.go:43 - Floeterm manages dormant logical terminal sessions before PTY activation.
[10] flowersec:flowersec-go/client/client.go:17 - Flowersec client sessions expose RPC, stream opening, ping, and close semantics.
[11] flowersec:flowersec-go/endpoint/session.go:19 - Flowersec endpoint sessions expose ServeStreams and OpenStream over the secure mux.
