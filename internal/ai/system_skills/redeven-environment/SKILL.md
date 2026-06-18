---
name: redeven-environment
description: Use when handling Redeven environment status, lifecycle operations, target routing, target diagnostics, or command execution against Redeven local, SSH, provider, gateway, or runtime targets.
---

# Redeven Environment

Use this skill for Redeven environment requests, including environment status, lifecycle actions, target routing, diagnostics, and command execution against a selected Redeven target.

## Core Rules

- `terminal.exec` runs in the local AI runtime unless a tool result explicitly reports a target execution location. Never infer remote execution from `execution_context`, target IDs, thread title, or environment card context alone.
- Use `redeven env ... --json` for environment status and lifecycle requests: list, resolve, status, diagnose, start, stop, restart, and update.
- Use `redeven targets exec ... --json` for arbitrary OS-level diagnostics on a Redeven target. Choose the OS command from the target facts and command output; do not expect Redeven to provide a dedicated subcommand for every diagnostic.
- If a Redeven command returns unsupported, unavailable, or blocked, explain the structured result and next product action. Do not invent lower-level Docker, SSH, systemd, launchctl, or process-manager workarounds.
- When using Ask Flower context, choose the target in this order: `execution_context.current_target_id`, then `target.target_id`, then `execution_context.source_env_public_id`, then `current`.

## Status and Lifecycle

Prefer these commands:

```sh
redeven env status --target <target> --json
redeven env diagnose --target <target> --json
redeven env start --target <target> --json
redeven env stop --target <target> --json
redeven env restart --target <target> --json
redeven env update --target <target> --json
```

Report the JSON contract, especially `supported`, `reason_code`, operation `availability`, `performed`, `command`, and `next_actions`.

## Target Diagnostics

For target OS facts such as current time, uptime, kernel, disk, process, package manager, or service status, use:

```sh
redeven targets exec --target <target> --command '<agent-selected command>' --json
```

Only claim that a command ran remotely when the JSON result contains a target execution location such as `execution_location=ssh_target` and the expected `target_id`.

If `redeven targets exec` is unavailable in the installed CLI, say that the current Redeven CLI cannot verify the target OS fact through the product command surface. Do not substitute plain `terminal.exec` and label it remote.
