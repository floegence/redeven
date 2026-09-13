---
name: redeven-environment
description: Use when handling Redeven environment status, lifecycle operations, target routing, target diagnostics, or command execution against Redeven local, SSH, provider, gateway, or runtime targets.
---

# Redeven Environment

Use this skill for Redeven environment requests, including environment status, lifecycle actions, target routing, diagnostics, and command execution against a selected Redeven target.

## Core Rules

- The Desktop/Runtime host provides `REDEVEN_CLI_PATH`, an absolute path to the
  bundled CLI that matches the running Runtime. Invoke that path directly; do
  not call a bare `redeven` command or search the system PATH. If the variable
  is missing or unusable, report `CLI_UNAVAILABLE` and stop the diagnostic.
- `terminal.exec` runs in the local AI runtime unless a tool result explicitly reports a target execution location. Never infer remote execution from `execution_context`, target IDs, thread title, or environment card context alone.
- Use `"$REDEVEN_CLI_PATH" env ... --json` for environment status and lifecycle requests: list, resolve, status, diagnose, start, stop, restart, and update.
- Use `"$REDEVEN_CLI_PATH" targets exec ... --json` for arbitrary OS-level diagnostics on a Redeven target. Choose the OS command from the target facts and command output; do not expect Redeven to provide a dedicated subcommand for every diagnostic.
- If a Redeven command returns unsupported, unavailable, or blocked, explain the structured result and next product action. Do not invent lower-level Docker, SSH, systemd, launchctl, or process-manager workarounds.
- An environment card records the user-selected device; the runtime snapshot separately identifies where tools run. Use the selected device's `target_id` (or `selected_target_id`) for that request. A later user selection supersedes the earlier one from that point onward; a follow-up without a new selection retains the established device.
- Use `current` only when the user is asking about the tool runtime itself and no selected device applies. If a selected target cannot be resolved, show its actionable error; never substitute a local diagnostic.
- Report the actual `target_id` and `execution_location` from command results. The terminal Activity describes the CLI launcher process; the nested target result describes where its diagnostic ran.

## Status and Lifecycle

Prefer these commands:

```sh
"$REDEVEN_CLI_PATH" env status --target <target> --json
"$REDEVEN_CLI_PATH" env diagnose --target <target> --json
"$REDEVEN_CLI_PATH" env start --target <target> --json
"$REDEVEN_CLI_PATH" env stop --target <target> --json
"$REDEVEN_CLI_PATH" env restart --target <target> --json
"$REDEVEN_CLI_PATH" env update --target <target> --json
```

Report the JSON contract, especially `supported`, `reason_code`, operation `availability`, `performed`, `command`, and `next_actions`.

## Target Diagnostics

For target OS facts such as current time, uptime, kernel, disk, process, package manager, or service status, use:

```sh
"$REDEVEN_CLI_PATH" targets exec --target <target> --command '<agent-selected command>' --json
```

Only claim that a command ran remotely when the JSON result contains a target execution location such as `execution_location=ssh_target` and the expected `target_id`.

If `redeven targets exec` is unavailable in the installed CLI, say that the current Redeven CLI cannot verify the target OS fact through the product command surface. Do not substitute plain `terminal.exec` and label it remote.
