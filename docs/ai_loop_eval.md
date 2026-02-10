# AI Loop Evaluation Workflow

This document defines the runtime evaluation workflow for Redeven Agent:

1. evaluate multiple loop/prompt combinations with real model + real tools,
2. score outcomes with consistent metrics,
3. converge to one default runtime profile.

## Goals

- Evaluate at least 20 profile combinations under real tool execution.
- Compare accuracy, naturalness, and efficiency using repeatable tasks.
- Keep evaluation safe: no write operations, no manual approval dependency.

## Entry Point

```bash
./scripts/eval_ai_loop_matrix.sh /Users/tangjianyin/Downloads/code/openclaw
```

Optional inputs:

- arg1: workspace absolute path.
- arg2: report output directory.
- env `TOP_K`: number of variants promoted from stage1 to stage2 (default `6`).
- env `MAX_VARIANTS`: cap evaluated variants (`0` means all variants).

## Variant Matrix

Prompt profiles (`6`):

- `natural_evidence_v2`
- `concise_direct_v1`
- `strict_no_preamble_v1`
- `evidence_sections_v1`
- `recovery_heavy_v1`
- `minimal_progress_v1`

Loop profiles (`4`):

- `adaptive_default_v2`
- `fast_exit_v1`
- `deep_analysis_v1`
- `conservative_recovery_v1`

Total variants: `6 x 4 = 24`.

## Task Set

Stage1 (screen):

- `openclaw_brief`
- `root_stat`
- `approval_fallback`

Stage2 (deep):

- `openclaw_deep`
- `openclaw_continue`

## Safety Rules

- Session permissions are fixed: `CanRead=true`, `CanWrite=false`, `CanExecute=true`.
- When approval is requested (for example `terminal.exec`), evaluator auto-rejects to avoid deadlock.
- Stream monitor cancels abnormal runs when either condition is hit:
  - repeated text delta loop,
  - repeated identical tool-call signature loop.

## Scoring

Each task emits three scores:

- `Accuracy`: task requirement coverage + evidence + no failure phrasing.
- `Natural`: low preamble noise + low repetition + readable completion.
- `Efficiency`: runtime, retries, loop churn, tool error cost.

Final score:

- `Overall = 0.5 * Accuracy + 0.3 * Natural + 0.2 * Efficiency`

## Outputs

Default output directory:

- `~/.redeven/ai/evals/<timestamp>/`

Artifacts:

- `report.json`: structured full results.
- `report.md`: ranking + per-task summary.
- `state/`: temporary AI runtime state for this evaluation run.

## Convergence Rule

- prioritize stage2 quality while keeping stage1 non-regressive;
- break ties by higher `Accuracy`;
- once a winner is selected, set prompt/loop defaults in runtime.

## Current Default (after evaluation)

Runtime default profiles are:

- Prompt profile: `natural_evidence_v2`
- Loop profile: `fast_exit_v1`

The default pair is chosen from the full matrix run and then validated with smoke reruns.
