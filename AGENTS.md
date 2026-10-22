# Redeven Repository Guide

Canonical repository rules. Keep this file within 100 lines, including headings and blank lines.

## Working Agreement

- Define the task scope, acceptance criteria, and non-goals before editing; diagnose from source contracts and reproducible evidence.
- The primary agent owns implementation through delivery. Do not create or delegate to subagents unless the user explicitly requests them for the current task.
- Design for a polished professional SaaS experience: clear actions, accessible controls, responsive layouts, and stable interaction state.
- Shape AI behavior through prompts and structured contracts. Prefer one authoritative state, one owner, and one clear path; remove duplication instead of adding speculative abstractions, heuristics, or silent fallbacks.
- Preserve existing functionality and user data. Changing or bypassing an `IMPORTANT:` invariant requires explicit user confirmation; never hide a workaround.
- Communicate decisions, acceptance evidence, and remaining limitations concisely and plainly.

## Git Workflow

- Develop in one task-owned worktree and named feature branch. Never develop on `main`; keep its worktree clean and use it only for fast-forward synchronization and final integration.
- Never modify another task's worktrees, branches, stashes, or runtimes. Do not create `backup/*` branches without explicit user instruction.
- Keep feature branches private; do not push them or create pull requests unless the user explicitly requests that collaboration path.
- From a clean feature worktree, fetch and `git rebase origin/main`; never merge main into features or features into each other.
- Resolve conflicts only in the feature worktree. Review both sides' substantive changes, preserve their intent, regenerate generated files, and never blindly use `--ours` or `--theirs`; abort if uncertain.
- Use English Conventional Commits: `<type>(<scope>): <summary>`, with lowercase type/scope and an imperative lowercase summary. Preserve meaningful commits; organize history inside the feature branch, never squash it during integration.
- Before integration, fetch, rebase, inspect `git diff origin/main...HEAD`, and run affected checks; then update main with `pull --ff-only` and integrate with `git merge --ff-only <branch>`.
- Push the complete latest local `main` tip through its exact-tip pre-push gate; never partial-push main, update remote main through another branch, bypass checks, or forge validation results.
- Verify `main == origin/main` and the corresponding Actions result, then remove this task's worktree and branch. Resolve temporary stashes; never leave detached HEAD worktrees as a substitute for cleanup.

## Validation And Delivery

- Reproduce behavior bugs before changing production code; use a deterministic failing test or document the external blocker.
- During development and after conflict resolution, run focused checks for affected behavior and contracts; fix failures with the smallest corresponding check first.
- Pre-commit stays fast and staged-source-only. Main pre-push runs `scripts/check_final_integration.sh` once for the exact base and tip; earlier or pre-rebase evidence does not certify a changed tip.
- Ordinary push/PR CI and the main gate stay bounded. Full browser, UI, Desktop, Docker, stress, performance, packaging, and native qualification belong to explicit local or dedicated release qualification workflows.
- Use isolated task-owned ports, state, and processes for local debugging; identify the actual product target and verify cleanup before reporting successful qualification.
- `.node-version` is the single source of truth for the first-party Node.js toolchain; `go.mod` owns the Go toolchain. Do not add older-version fallbacks.

## Ownership And Localization

- Consume published upstream artifacts. Shared platform, UI, terminal, template-format, and Floret mechanics belong to their owning repositories; Redeven implements thin product adapters.
- Never add sibling source imports, Go `replace`, local package links, or copied upstream implementations. Temporary debugging workspaces/overlays must be untracked, task-owned, and removed before committing or formal validation against published releases with `GOWORK=off`.
- Redeven migrates only its own databases, automatically before service readiness, through contiguous atomic verified migrations. Preserve released lineages and user records; reject unsupported inputs unchanged and keep upstream stores opaque.
- Maintain repository content and commits in English; non-English belongs only to scoped localization resources, declared README translations, and language-sensitive fixtures.
- All product UI copy uses i18n keys. Every shipped locale has an explicit complete catalog with matching placeholders/plurals and fluent terminology; never silently inherit English or Simplified Chinese into Traditional Chinese.
- Preserve `Activity`, `Workbench`, and `Redeven Cloud`; localize generic AI model providers (`模型提供商` in `zh-CN`). Keep `Provider` technical, never the user-facing control-plane brand.
- README translations must mirror canonical `README.md` and `assets/readme/locales.json`; run the localization checker and its tests, preserving structure, literals, terminology, and synchronization hashes.

## Knowledge Maintenance

- `okf/` is the only maintained knowledge corpus. Consult [the OKF index](okf/index.md) and relevant concepts when additional context is needed.
- Update affected OKF contracts with architecture, protocol, permission, interaction, runtime, CI, or release changes; derive claims from current code, tests, and active contracts.
- Each concept answers one coherent question, begins with `# Summary`, separates contracts from evidence, and avoids duplicated ownership or stale implementation inventories. Target 8,000 body characters; split above 12,000 unless justified.
- Keep all authored OKF Markdown, including `index.md` and `log.md` but excluding generated `dist/`, below a 1,000,000 Unicode-character hard limit; target at most 900,000. Strict quality checks enforce the cap.
- Every concept declares `lifecycle` and `reviewed_at`: `contract` is reviewed every 180 days, `active_evidence` every 90 days, and `retained_history` every 365 days with a concise `retention_reason`. Expired content must be revalidated, consolidated, or removed; do not add an OKF archive.
- After OKF edits, regenerate and commit all three `okf/dist/` bundle artifacts; run `scripts/okf/check_source_integrity.sh` and `scripts/build_okf_bundle.sh --verify-only`.
- Add domain rules to their owning OKF concept, not this file. Do not restore retired documentation trees or add a committed `.develop.md` or parallel rulebook.
