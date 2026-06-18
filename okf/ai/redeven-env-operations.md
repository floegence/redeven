---
type: AI Operation Contract
title: Redeven environment operations
description: redeven env is the product boundary for Flower and automation environment lifecycle requests.
tags: [ai, flower, cli, desktop, runtime]
timestamp: 2026-06-18T00:00:00Z
---

Redeven environment lifecycle requests must go through the Redeven product surface, not through inferred container, SSH, systemd, launchctl, or process-manager commands.

# Mechanism

The `redeven env` CLI surface exposes machine-readable environment status, diagnostics, and lifecycle operation plans through the shared agent protocol envelope. `list`, `resolve`, `status`, `diagnose`, and `stop` are executable for the supported default Local Environment path. `start`, `restart`, and `update` are phase-one planning entries: they return structured availability, reason codes, and next actions rather than pretending the CLI can start or update Desktop runtime sessions.

Ask Flower environment context supplies routing data through the standard context action. `execution_context.current_target_id` is the primary operation target, followed by `target.target_id`, then `execution_context.source_env_public_id`. The prompt pack renders these execution fields so Flower can call `redeven env ... --json` with the same scoped target the user selected in Welcome. The literal target `current` is accepted by Redeven environment resolution as the current default environment alias.

`redeven env` also recognizes Redeven target shapes that phase one does not execute, including local container, SSH, provider, Gateway, and external Local UI targets. Recognized-but-unsupported targets return successful business plans with `supported=false` or operation `availability=unavailable` and `reason_code=unsupported_target_kind`; they must not fall out to Docker or SSH command inference.

# Boundaries

`redeven env` output is sanitized for Flower and automation. Target and runtime summaries omit local state, config, and runtime-control socket paths, runtime-control tokens, and raw Desktop launch reports. Diagnostic output may include local state, lock, and socket paths when those paths are necessary to explain runtime attach state. Operation commands in the JSON contract may name Redeven product commands only. If an operation returns a structured unavailable or blocked plan, Flower should explain that plan and the product next action instead of inventing a lower-level workaround.

# Citations

[1] redeven:cmd/redeven/env.go:13 - The `env` command dispatches lifecycle subcommands.
[2] redeven:internal/agentprotocol/env.go:60 - Environment status, runtime summary, diagnostics, and operation plans define the JSON contract.
[3] redeven:internal/agentprotocol/env.go:120 - Environment target resolution distinguishes supported local targets from recognized unsupported target shapes.
[4] redeven:internal/agentprotocol/env.go:196 - Runtime summaries sanitize attach status and omit runtime-control endpoint tokens.
[5] redeven:internal/ai/context_action.go:243 - Ask Flower context actions are converted into model-facing user-provided context.
[6] redeven:internal/ai/native_runtime.go:2259 - Prompt message rendering includes user-provided context metadata.
[7] redeven:internal/ai/prompt_builder.go:328 - Tool routing instructs Flower to use OKF and `redeven env ... --json` for environment lifecycle operations.
