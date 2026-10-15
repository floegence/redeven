---
type: AI Prompt Contract
title: Flower prompt and rule sources
description: Unify task, interaction and recovery instructions with actual capabilities and complete authorized rule sources.
tags: [ai, flower, prompts, context]
timestamp: 2026-10-15T00:00:00Z
---
# Summary

Flower uses one task, interaction and recovery policy across its three profiles.
The current tool surface supplies operation instructions; admitted context carries
complete facts and rule-source manifests. Missing capabilities and invalid context
produce concrete recovery conditions without a second lifecycle or silent clipping.

# Contract

One task policy, interaction policy, and failure-recovery policy govern all three
Flower profiles. Profiles express persona and user-interaction differences.
Operational guidance comes from the selected `runToolSurface`, including actual
control signals, rather than permission-mode guesses. Supplied material may be
answered directly; current file, external, and execution claims require evidence.
User and repository restrictions override generic delegation advice.

Runtime context admits rule-source descriptors: absolute path, applicable
directory, and readable status. Discovery uses the authorized filesystem Registry
and checks symlinks; it does not inject rule bodies or previews. Supported names
remain `AGENTS.md`, `CLAUDE.md`, `.develop.md`, and `.introduce.md`. Before a governed
operation, Flower reads every applicable source to its end with current tools.
Another worktree or target directory requires discovery along its own repository
ancestor path. Specific directory rules override ancestor defaults; incompatible
same-scope rules use the interaction policy. Unreadable sources or missing reading
capabilities block affected operations while independent work may continue.

The complete runtime snapshot and assembled input pass published Floret public
validation before execution authority is saved. No final host-side clipping hides
sources or skill entries. Overflow rejects admission, releases the send operation
and workload lease, and permits a corrected input with the same request identity.
Earlier canonical context and provider checkpoints remain immutable. Skill
catalogs are admission facts; current capabilities alone supply activation advice.

When a decision requires the user and `ask_user` is supplied, Flower uses the
structured canonical interaction. Without that capability, the main assistant
finishes with the blocker and recovery condition; a child reports to its parent.
There is no host waiting state or duplicate question before tool approval.

A running command is observed through its existing process identity and cursor;
repeated observations are valid when state may change. Timeouts do not establish
that an effect never executed and do not independently authorize replay. An
unknown effect remains terminal. Denials cannot be bypassed with another tool.
Schema correction, approval, cancellation and restart recovery remain Floret-owned.
Todos permit at most one `in_progress` item and an explicit empty-list clear.

The working directory is a relative-path default. Configured filesystem roots
and their read/write permissions define authorization; task scope and repository
rules determine relevant work. Authorized sibling worktrees use explicit terminal
`cwd`/`workdir` and absolute file paths. `apply_patch` remains confined to the run
working directory, so another worktree uses `file.edit` or `file.write` when
supplied. The unreachable `file.read` definition and dispatch are removed;
`read_file` keeps the shared bounded reader and complete typed pagination fields.
Historical canonical file actions remain readable without restoring that tool.

Ordinary research uses available research tools directly. User acceptance is
required when substituting a text-page alternative for an explicitly requested
interactive GUI operation. A blocked target cannot be fetched through a substitute.

# Boundaries

Redeven owns product prompts and tool adaptation. The published Floret runtime owns
canonical interaction, approval, cancellation, context validation and recovery.
This change adds no public API, tool input shape, storage schema, durable rule
loader, provider checkpoint rewrite or parallel waiting lifecycle.

# Evidence

- `redeven:internal/ai/prompt_builder.go` - One behavior policy with capability-gated operation instructions.
- `redeven:internal/ai/prompt_profiles.go` - Three profiles express role and interaction differences.
- `redeven:internal/ai/prompt_workspace_context.go` - Authorized rule descriptors and complete validated runtime context.
- `redeven:internal/ai/send_user_turn.go` - Complete input validation precedes execution-authority persistence.
- `redeven:internal/ai/prompt_consistency_test.go` - Actual permission, profile and allowlist matrix governs instructions.
- `redeven:internal/ai/prompt_rule_sources_test.go` - Long Unicode rules, complete read pages, discovery failures and worktree authorization.
- `redeven:internal/ai/prompt_context_admission_test.go` - Overflow releases busy state and permits corrected retry without canonical mutation.
- `redeven:internal/ai/floret_ask_user_integration_test.go` - A fresh supplied-prompt analysis completes without tools and accepts follow-up input.
- `redeven:internal/ai/thread_permission_admission_test.go` - Actual provider requests match live permission surfaces.
- `redeven:internal/ai/tools/orchestrator_test.go` - Timeout and denial advice cannot authorize unsafe replay or bypass.
