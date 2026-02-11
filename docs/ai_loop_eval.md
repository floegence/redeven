# AI Loop Evaluation Workflow

This document defines the validation workflow for Redeven Agent loop/profile selection.

The workflow is gate-first:

1. replay known failure trajectories,
2. evaluate matrix variants with real model + real tools,
3. compare against open-source baselines (`codex`, `cline`, `opencode`),
4. block recommendation when hard gates are not met.

## Entry Points

### Matrix evaluation (ranking only)

```bash
./scripts/eval_ai_loop_matrix.sh /Users/tangjianyin/Downloads/code/openclaw
```

### Full hard gate workflow (recommended for default promotion)

```bash
./scripts/eval_gate.sh /Users/tangjianyin/Downloads/code/openclaw
```

## Inputs

Environment variables:

- `TOP_K`: number of variants promoted from stage1 to stage2 (default `6`)
- `MAX_VARIANTS`: cap evaluated variants (`0` means all variants)
- `TASK_SPEC_PATH`: task spec yaml path (default `eval/tasks/default.yaml`)
- `BASELINE_PATH`: baseline json path (default `eval/baselines/open_source_best.json`)
- `ENFORCE_GATE`: set `1` to fail command when hard gate rejects

CLI flags (`cmd/ai-loop-eval`):

- `--task-spec`
- `--baseline`
- `--enforce-gate`
- `--min-pass-rate`
- `--min-loop-safety-rate`
- `--min-fallback-free-rate`
- `--min-accuracy`

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

## Task Specs

Tasks are loaded from YAML (`eval/tasks/default.yaml`) and support:

- stage (`screen` / `deep`)
- category (`failure_real` / `generic`)
- required evidence, required keywords, forbidden phrases
- hard fail events (for example `turn.loop.exhausted`)

## Hard Gate

Hard gate compares each variant against:

1. absolute thresholds,
2. best metrics across open-source baseline sources.

Gate metrics:

- `pass_rate`
- `loop_safety_rate`
- `recovery_success_rate`
- `fallback_free_rate`
- `average_accuracy`

Gate output is written into `report.json` under `gate` and `variant_metrics`.

If `--enforce-gate` is enabled:

- no passing variant => command exits non-zero,
- recommended variant failing gate => command exits non-zero.

## Replay Validation

`cmd/ai-loop-replay` replays message logs and fails on known anti-patterns:

- fallback final text (`loop limit`, `No response`, etc.),
- tool-heavy runs without concrete conclusion.

Fixtures:

- `eval/replay_cases/loop_exhausted_fail.message.log.json`
- `eval/replay_cases/normal_pass.message.log.json`

## Outputs

Default output directory:

- `~/.redeven/ai/evals/<timestamp>/`

Artifacts:

- `report.json`: full structured results, gate decisions, per-variant metrics.
- `report.md`: human-readable ranking + gate summary.
- `state/`: temporary runtime state for this evaluation run.

## Current Runtime Default

- Prompt profile: `natural_evidence_v2`
- Loop profile: `fast_exit_v1`

Any future default update should be done only after `scripts/eval_gate.sh` passes.
