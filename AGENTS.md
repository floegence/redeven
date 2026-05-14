# Redeven Repository Guide

This file is the repository-level operating guide for `redeven/`.

Goals:

- keep development, release, and open-source hygiene consistent and auditable;
- never develop directly on `main`;
- preserve every intentional commit;
- keep local `main` and `origin/main` aligned whenever `main` is pushed;
- standardize repository rules on `AGENTS.md` instead of a committed `.develop.md`.

## Git Workflow (Worktree, Required)

- Never develop directly on `main`.
- Every change must be done in a dedicated worktree plus feature branch.
- `main` is only for `pull --ff-only` and final integration.
- Do not leave uncommitted changes in the `main` worktree.
- Never introduce or rely on `go.work` or `go.work.sum` in this repository, sibling repositories, or their shared parent directory as a cross-repo development shortcut.
- `redeven` consumes published upstream releases only. Do not wire local sibling repositories into builds, tests, or release validation.
- If local `main` is pushed, push the full current local `main` tip together with all of its latest commits.
- Do not partial-push `main`, and do not update `origin/main` through another branch while newer local `main` commits remain unpublished.
- One feature equals one dedicated worktree plus one local private branch.
- Keep feature branches private until they are merged into `main`.
- Default sync strategy for a feature branch: `git rebase origin/main`.
- Do not merge `origin/main` into a feature branch in the normal flow.
- Preserve intentional commit history when integrating:
  - use `git merge --ff-only "$BR"` on `main` once the feature branch history is ready;
  - if the feature branch history is too noisy, clean it inside the feature branch before integration instead of hiding it behind `--squash`.
- Resolve conflicts only inside the feature worktree, never on `main`.
- Do not merge feature branches into each other.

Recommended setup:

```bash
git fetch origin
git switch main
git pull --ff-only

BR=feat-<topic>
WT=../redeven-feat-<topic>
git worktree add -b "$BR" "$WT" origin/main
```

## Feature Sync

Inside the feature worktree:

```bash
git status
# The worktree must be clean before rebasing.

git fetch origin
STAMP=$(date +%Y%m%d-%H%M%S)
git branch "backup/$BR-$STAMP"
git rebase origin/main
```

If conflicts happen:

```bash
git add <resolved-files>
git rebase --continue
```

If you are unsure:

```bash
git rebase --abort
```

After every rebase:

```bash
git range-diff "backup/$BR-$STAMP"...HEAD
git diff origin/main...HEAD
```

Then rerun the relevant local quality gate from this file.

## Integration Back To Main

Once the feature branch is ready:

```bash
git switch main
git fetch origin
git pull --ff-only

# If local main is already ahead of origin/main, publish the full local main tip first.
# Do not keep older local main commits unpublished while only pushing the new feature result.
# git push origin main

git merge --ff-only "$BR"
git push origin main
```

Cleanup:

```bash
git worktree remove "$WT"
git branch -d "$BR"
```

If the feature branch was pushed:

```bash
git push origin --delete "$BR"
```

Additional rules:

- Remote `main` should always move directly to the latest local `main` tip whenever `main` is pushed.
- Do not discard, collapse, or silently rewrite meaningful feature commits during integration.
- If a feature branch has already been pushed and someone depends on it, switch to a conservative coordination flow instead of freely rewriting history.

Recommended Git configuration:

```bash
git config --global rerere.enabled true
git config --global merge.conflictstyle zdiff3
```

## Conflict Resolution Principles

- Resolve conflicts only in the feature worktree.
- If a conflict happens on `main`, abort and go back to the feature branch.
- During `git rebase origin/main`, do not use `--ours` and `--theirs` blindly:
  - `--ours` usually means the rebasing target (`origin/main`);
  - `--theirs` usually means the replayed feature commit.
- Start from the latest `main` structure and then re-apply the real feature intent on top of it.
- For renames, file moves, formatting changes, or import reshuffles:
  - keep the latest `main` layout first;
  - then restore the feature logic in the new location.
- For generated files, snapshots, and lockfiles:
  - prefer regeneration over manual conflict stitching.
- For shared contracts, schemas, and cross-repo payload fields:
  - align semantics manually instead of blindly taking one side.
- If you are not confident about the resolution, abort the rebase and reassess.

## Repository Language Policy

- English is the default language for maintained repository content, including:
  - source code identifiers and messages where practical;
  - code comments;
  - Markdown and other documentation files;
  - scripts and examples.
- Multilingual test fixtures are allowed only when they are necessary to validate language-sensitive behavior, and they must remain clearly scoped and documented in English.

## AI Design Principles

- Prefer prompt-first behavior shaping through prompts and structured contracts.
- Do not add scenario-specific hardcoded heuristics for one-off requests.
- Target generalized orchestration mechanisms rather than stacking special cases.
- Keep important intent and policy decisions observable through events or logs.

## IMPORTANT Design Constraints

- `IMPORTANT:` comments mark product, security, or interaction invariants that must stay rare, intentional, and backed by code or tests where practical.
- If a change would remove, bypass, weaken, or contradict an `IMPORTANT:` comment, discuss the design impact with the user and receive explicit confirmation before implementing that change.
- Do not work around an `IMPORTANT:` constraint with hidden fallback behavior, alternate entry points, or silent compatibility paths.
- When adding a new `IMPORTANT:` comment, keep it concise, explain the invariant rather than the implementation detail, and add focused test coverage or another enforceable guard whenever possible.

## Published Dependency Policy

- `redeven` is a downstream consumer of `floeterm`, `floe-webapp`, and `flowersec`.
- Never reference local sibling checkouts through package manifests, lockfiles, build aliases, source imports, or Go workspace wiring.
- Forbidden local wiring includes `file:`, `link:`, `workspace:`, `portal:`, relative paths, absolute paths, and equivalent local indirection.
- Required flow:
  - implement upstream first in the source repository;
  - release it;
  - confirm the release artifacts are available;
  - then upgrade `redeven` to the published version.

## UI Interaction Affordance

- Any clickable or directly interactive UI control must expose a pointer cursor while it is interactive.
- Do not ship controls that look clickable while still using the default arrow cursor.
- Disabled controls are the exception and must use a clearly non-interactive cursor treatment.

## Workbench Wheel Ownership

- Inside Workbench, wheel / trackpad scrolling belongs to the canvas by default. Blank canvas areas and unselected widget bounds may zoom the canvas.
- The currently selected widget boundary is a canvas-zoom guard: wheel events inside the selected widget must never trigger canvas zoom.
- Inside the selected widget, local scrolling is allowed only when the pointer is inside an explicitly marked, real constrained local scroll viewport. Otherwise the wheel event should resolve to ignore/no-op, not canvas zoom and not fake local scrolling.
- Unselected widgets must never capture, consume, or block wheel input. Hover state, visual scroll affordance, embedded lists, or transient focus do not grant wheel ownership.
- Internal controls such as terminals that capture wheel early may consume wheel only when the selected widget and the control's own active/focused state allow local scrolling; otherwise they must suppress their own scroll without forwarding to canvas zoom.
- If a selected widget looks scrollable but does not actually scroll, fix the layout, height chain, and `overflow` viewport structure instead of weakening wheel-routing rules for unselected widgets.
- Production Workbench scroll viewports must use the exported wheel contract props from `workbenchWheelInteractive.ts`; do not hand-write raw wheel data attributes or bypass the static `check:workbench-wheel` gate.

## Workbench Text Selection Ownership

- Text selection and copy inside Workbench are a first-class interaction contract alongside wheel, typing, and activation. Do not rely on shell activation, transient focus, global shortcut hacks, or accidental browser defaults as the long-term mechanism.
- For real text-bearing reading surfaces, drag-to-select must win over widget activation, canvas interaction, and shell focus reclaim. Building or extending a text selection must never trigger widget-body activation, canvas zoom, or terminal focus restoration as a side effect.
- "Text-bearing reading surfaces" includes both explicitly marked viewers (for example preview/diff/terminal/editor surfaces) and ordinary DOM text regions inside widgets when that text is naturally selectable. Plain headings, labels, status lines, metadata blocks, and similar read-only text must not silently fall back to widget-body activation semantics.
- A text-selection surface inside the selected widget may own pointer semantics for selection/copy without owning wheel semantics. Unless that same surface is also an explicitly marked real local scroll viewport, wheel must continue to follow the selected-widget guard and resolve to ignore/no-op rather than canvas zoom.
- Unselected widgets may still become selected on an initial plain click inside a reading surface, but drag-to-select must not be broken by the selection flow. Do not require users to sacrifice native text selection, browser copy, or terminal/Monaco selection lifecycles just to select the widget first.
- `Ctrl/Cmd+C` should defer to the browser, Monaco, terminal, and other controls that already copy from a real selection. Do not add product-level fallbacks that force copy with no verified local selection or that blanket-intercept every copy shortcut.
- Any surface that needs special local pointer ownership for text selection must declare it through explicit exported marker/props contracts, and that contract must not silently broaden wheel ownership.
- If a region looks like selectable text but cannot be selected, extended, or copied reliably, fix its marker contract, focus/activation routing, or DOM structure. Do not paper over the bug by weakening shell interaction globally, granting more power to unselected widgets, or adding scenario-specific shortcut exceptions.

## Release

### Runtime Release

- Stable tags should use `vX.Y.Z`.
- Semver extensions are allowed when needed.
- Pushing the tag triggers `.github/workflows/release.yml`.
- GitHub Release artifacts and signing files must remain aligned with the release tag.

### Runtime/Desktop Compatibility Release Contract

- `internal/runtimeservice/compatibility_contract.json` is the single source of truth for the Runtime Service protocol compatibility window.
- Before pushing any `vX.Y.Z` release tag, update that contract so `release_review.release_version` equals the exact tag that will be pushed.
- Run `./scripts/check_runtime_compatibility_contract.sh vX.Y.Z` before tagging. The release workflow runs the same check and must stay green before artifacts are trusted.
- If a new release keeps the same protocol version, compatibility epoch, minimum Desktop version, and minimum Runtime version as the previous release, treat that as a challenged decision:
  - fill `release_review.same_window_rationale` with the explicit reason the old compatibility window is still safe;
  - keep `release_review.checked_surfaces` broad enough to cover Desktop attach/start, Local UI health, startup reports, `sys.ping`, Env App maintenance UI, and SSH runtime bootstrap when touched;
  - do not tag until the rationale and reviewed surfaces explain why no compatibility window change is needed.
- If the Runtime Service protocol contract changes, bump `compatibility_epoch` or the relevant minimum version fields instead of relying on ad hoc UI checks.
- Do not use release notes, installer metadata, or Desktop-only conditionals as the compatibility source of truth; they may describe the policy, but they must not replace the contract file.

### Public Installer Contract

- `scripts/install.sh` is the source of truth for the public installer.
- The installer resolves versions from GitHub Releases unless `REDEVEN_VERSION` is explicitly provided.
- Public repository scope stops at the GitHub Release contract and installer verification flow.

## Local Quality Gate

Run the CI-aligned local checks before integration:

- `sh -n scripts/install.sh`
- `sh -n scripts/generate_release_notes.sh`
- `bash -n scripts/lint_ui.sh`
- `bash -n scripts/build_desktop_bundled_agent.sh`
- `bash -n scripts/check_desktop.sh`
- `bash -n scripts/check_runtime_compatibility_contract.sh`
- `bash -n scripts/ui_package_common.sh`
- `bash -n scripts/open_source_hygiene_check.sh`
- `bash -n scripts/install_git_hooks.sh`
- `./scripts/lint_ui.sh`
- `./scripts/check_runtime_compatibility_contract.sh --source-only`
- `./scripts/check_desktop.sh`
- `./scripts/open_source_hygiene_check.sh --staged`
- `./scripts/open_source_hygiene_check.sh --all`
- `./scripts/knowledge/check_source_integrity.sh`
- `./scripts/build_knowledge_bundle.sh --verify-only`
- `./scripts/build_assets.sh`
- `go test ./...`
- `golangci-lint run ./...`

## Repository Rule File

- `AGENTS.md` is the canonical repository rule file for this repository.
- Do not add or keep a committed repository-level `.develop.md` here.
