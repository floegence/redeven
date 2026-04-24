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

- Inside Workbench, wheel / trackpad scrolling belongs to the canvas by default.
- A widget may own wheel scrolling only when it is the **currently selected widget** and the pointer is inside a **real constrained local scroll viewport**.
- Unselected widgets must never capture, consume, or block wheel scrolling. Hover state, visual scroll affordance, or embedded thread lists are not enough to transfer ownership.
- If a selected widget looks scrollable but does not actually scroll, fix the layout, height chain, and `overflow` viewport structure instead of weakening wheel-routing rules for unselected widgets.

## Release

### Runtime Release

- Stable tags should use `vX.Y.Z`.
- Semver extensions are allowed when needed.
- Pushing the tag triggers `.github/workflows/release.yml`.
- GitHub Release artifacts and signing files must remain aligned with the release tag.

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
- `bash -n scripts/ui_package_common.sh`
- `bash -n scripts/open_source_hygiene_check.sh`
- `bash -n scripts/install_git_hooks.sh`
- `./scripts/lint_ui.sh`
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
