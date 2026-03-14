# AI Loop Evaluation Workflow

This document describes the current validation workflow for loop and prompt profile selection in Redeven Agent.

The workflow is gate-first:

1. replay known failure trajectories
2. evaluate profile variants with real models and real tools
3. compare results against open-source baselines
4. block default promotion when hard gates are not met

## Entry points

### Matrix ranking

```bash
./scripts/eval_ai_loop_matrix.sh /abs/path/to/target-repo
```

### Full hard-gate evaluation

```bash
./scripts/eval_gate.sh /abs/path/to/target-repo
```

## Inputs

Environment variables:

- `TOP_K`
- `MAX_VARIANTS`
- `TASK_SPEC_PATH`
- `BASELINE_PATH`
- `ENFORCE_GATE`

CLI flags from `cmd/ai-loop-eval`:

- `--task-spec`
- `--baseline`
- `--enforce-gate`
- `--min-pass-rate`
- `--min-loop-safety-rate`
- `--min-fallback-free-rate`
- `--min-accuracy`

## Variant matrix

Prompt profiles:

- `natural_evidence_v2`
- `concise_direct_v1`
- `strict_no_preamble_v1`
- `evidence_sections_v1`
- `recovery_heavy_v1`
- `minimal_progress_v1`

Loop profiles:

- `adaptive_default_v2`
- `fast_exit_v1`
- `deep_analysis_v1`
- `conservative_recovery_v1`

## Task specs

Tasks are loaded from YAML under `eval/tasks/` and support:

- stage (`screen` / `deep`)
- category (`failure_real` / `generic`)
- required evidence
- required keywords
- forbidden phrases
- hard-fail events

## Hard gate

Hard gate compares each variant against:

1. absolute thresholds
2. best metrics across configured open-source baselines

Metrics currently used by the gate:

- `pass_rate`
- `loop_safety_rate`
- `recovery_success_rate`
- `fallback_free_rate`
- `average_accuracy`

Gate output is written into `report.json` under `gate` and `variant_metrics`.

## Replay validation

`cmd/ai-loop-replay` replays message logs and rejects known anti-patterns such as:

- fallback final text
- tool-heavy runs without a concrete conclusion

Fixtures live in:

- `eval/replay_cases/loop_exhausted_fail.message.log.json`
- `eval/replay_cases/normal_pass.message.log.json`

## Outputs

Default output directory:

- `~/.redeven/ai/evals/<timestamp>/`

Artifacts:

- `report.json`
- `report.md`
- `state/`

## Current runtime default

- Prompt profile: `natural_evidence_v2`
- Loop profile: `fast_exit_v1`

Any future default update should be made only after `scripts/eval_gate.sh` passes.
