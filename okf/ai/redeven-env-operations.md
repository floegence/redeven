---
type: AI Operation Contract
title: Redeven environment operations
description: redeven env and redeven targets exec are the product boundaries for Flower and automation environment lifecycle and target diagnostic requests.
tags: [ai, flower, cli, desktop, runtime]
timestamp: 2026-07-10T00:00:00Z
---
# Summary

Redeven environment lifecycle requests must go through the Redeven product surface, not through inferred container, SSH, systemd, launchctl, or process-manager commands. Flower learns this boundary through the standard `redeven-environment` system skill, not through a bespoke environment workflow embedded in the global prompt.

# Contract

## Mechanism

The `redeven env` CLI surface exposes machine-readable environment status, diagnostics, and lifecycle operation plans through the shared agent protocol envelope. `list`, `resolve`, `status`, `diagnose`, and `stop` are executable for the supported default Local Environment path. `start`, `restart`, and `update` are phase-one planning entries: they return structured availability, reason codes, and next actions rather than pretending the CLI can start or update Desktop runtime sessions. When the target catalog contains SSH, container, provider, Gateway, or external Local UI entries, `redeven env` may resolve the target but still returns the lifecycle request as `supported=false` with `reason_code=unsupported_target_kind` unless the target is the default Local Environment.

Ask Flower environment context supplies routing data through the standard context action. When the accepted turn starts, Redeven can project these fields into Floret current-turn supplemental context metadata, but they remain product context and UI/audit facts rather than permission, remote execution proof, builtin target routing, or Redeven-owned provider history. The `redeven-environment` skill tells Flower to choose targets in this order: `execution_context.current_target_id`, then `target.target_id`, then `execution_context.source_env_public_id`, then `current`. The literal target `current` is accepted by Redeven target resolution as the current default environment alias.

For arbitrary target OS diagnostics, Flower should use `redeven targets exec --target <target> --command <agent-selected command> --json`. This command lets the agent choose OS-appropriate probes such as `date`, `uname`, uptime, disk, process, package manager, or service checks while Redeven owns target resolution, execution location, timeout, stdout/stderr, and exit-code provenance. The command supports the default Local Environment shell and saved local/SSH host runtime targets with key or agent SSH auth. Password SSH targets, container placements, provider environments, Gateway environments, and external Local UI targets return structured unsupported or unavailable results instead of falling back to ad hoc low-level commands.

# Boundaries

`redeven env` and `redeven targets exec` output is sanitized for Flower and automation. Target and runtime summaries omit runtime-control tokens and avoid leaking local state, config, socket, and agent home paths where those paths are not needed for the contract. Diagnostic output may include local state, lock, and socket paths when those paths are necessary to explain runtime attach state. Operation commands in the environment JSON contract may name Redeven product commands only. Target execution JSON must include `target_id` and `execution_location` when execution occurs. If an operation or target execution returns a structured unavailable, unsupported, or blocked result, Flower should explain that result and the product next action instead of inventing a lower-level workaround.

`terminal.exec` remains the local AI runtime shell. It starts an interactive PTY process with a local `process_id`, can be inspected with `terminal.read`, driven with `terminal.write`, and stopped with `terminal.terminate`. It can be used to invoke Redeven product commands, but it must not be described as remote execution unless the product command result itself contains target execution provenance such as `execution_location=ssh_target`.

# Evidence

- `redeven:cmd/redeven/env.go:13` - The `env` command dispatches lifecycle subcommands.
- `redeven:internal/agentprotocol/env.go:60` - Environment status, runtime summary, diagnostics, and operation plans define the JSON contract.
- `redeven:internal/agentprotocol/targets.go:37` - Target discovery projects the default local target and saved catalog connections into target descriptors.
- `redeven:internal/agentprotocol/target_exec.go:39` - Target command execution returns structured target, command, location, stdout/stderr, exit-code, timeout, and support fields.
- `redeven:internal/ai/system_skills/redeven-environment/SKILL.md:1` - The system skill teaches Flower the Redeven environment and target execution command surfaces.
- `redeven:internal/ai/context_action_floret.go:200` - Ask Flower execution metadata is projected into Floret supplemental context metadata for the current turn.
