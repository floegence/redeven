---
name: redeven-control
description: Control and inspect Redeven targets from an AI coding agent using the Redeven CLI and Agent Skills only. Use when a user asks Claude Code, Codex, OpenCode, Cline, or another skill-aware agent to find a connected Redeven environment, inspect target status, or prepare a Redeven-controlled workflow without MCP.
---

# Redeven Control

Use this skill when the user wants the current agent to work with Redeven-controlled devices or environments.

## Core Rule

Do not start or configure MCP. Redeven is controlled through the `redeven` CLI and the protocol JSON envelopes returned by that CLI.

## Workflow

1. Discover targets:

```bash
redeven targets list --json
```

2. Resolve the target the user named. If the user did not name one and only one target is available, use `local`.

```bash
redeven targets resolve --target local --json
```

3. Inspect the envelope:

- `ok: true` means `data` contains the resolved target or catalog.
- `ok: false` means report `error.message` and stop.
- `trace.target_id` is the stable target handle for later Redeven commands.

4. Prefer target capabilities over assumptions:

- `local_ui` means a Local UI URL is available for browser-based work.
- `remote_control` means the Local Environment is bound to a control-plane environment.
- `flower` means Flower is configured in the local runtime config.
- `codex_gateway` means the running Env App gateway can expose Codex host diagnostics.

## Safety

- Never trust a browser-provided permission field as authoritative.
- Never copy capability credentials into the chat.
- Do not claim remote target mutation is available unless the Redeven CLI response exposes that capability.
- If a requested action is not represented by the current CLI contract, explain the missing Redeven capability instead of inventing a shell workaround.

## Bundled Scripts

Use `scripts/list_targets.sh` and `scripts/resolve_target.sh` when deterministic CLI invocation is useful. Both scripts call the local `redeven` binary and print the protocol envelope unchanged.
