# Redeven Repository Guide

This file is the repository-level operating guide for `redeven/`.

Goals:

- keep development, release, and open-source hygiene consistent and auditable;
- never develop directly on `main`;
- preserve every intentional commit;
- keep local `main` and `origin/main` aligned whenever `main` is pushed;
- consume ReDevPlugin as a released plugin-platform dependency while keeping
  Redeven-specific business adapters in this repository;
- standardize repository rules on `AGENTS.md` instead of a committed `.develop.md`.

## Git Workflow (Worktree, Required)

- Never develop directly on `main`.
- Every change must be done in a dedicated worktree plus feature branch.
- `main` is only for `pull --ff-only` and final integration.
- Do not leave uncommitted changes in the `main` worktree.
- Do not create routine `backup/*` branches. If recovery is needed, abort the
  rebase, inspect the feature worktree, and use explicit user-approved branches
  only when the branch itself has a real collaboration purpose.
- `git stash` is allowed only as a short-term safety rope before rebasing or
  switching context. Every stash must be applied back and continued, or dropped
  once it is confirmed obsolete. Do not leave stale stashes as hidden work.
- Never introduce or rely on `go.work` or `go.work.sum` in this repository, sibling repositories, or their shared parent directory as a cross-repo development shortcut.
- `redeven` consumes published upstream releases only. Do not wire local sibling repositories into builds, tests, or release validation.
- If local `main` is pushed, push the full current local `main` tip together with all of its latest commits.
- Do not partial-push `main`, and do not update `origin/main` through another branch while newer local `main` commits remain unpublished.
- One feature equals one dedicated worktree plus one local private branch.
- Keep feature branches private until they are merged into `main`.
- Do not push feature branches or create pull requests unless the user explicitly asks for that collaboration path.
- Do not create a pull request merely to trigger CI; by default, fast-forward the ready feature into `main`, push `main`, and verify the `main` Actions run.
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

After every rebase, inspect the resulting feature diff:

```bash
git diff origin/main...HEAD
```

Use staged validation so full gates run only on the final rebased tip:

- During implementation, and after any intermediate rebase that is still
  expected to be superseded by more edits, reviews, generated artifacts, or
  another upstream sync, run only focused checks for the affected behavior.
- Do not repeatedly run the full repository or product quality gate on
  intermediate feature tips. A passing full gate on a commit that is later
  rebased is not final integration evidence.
- Once implementation, required reviews, localization work, and generated
  artifacts are complete, fetch `origin`, rebase onto the latest `origin/main`,
  inspect `git diff origin/main...HEAD`, and run the affected focused checks.
- Do not run the full integration gate from routine feature commits. After the
  rebased feature is fast-forwarded into local `main`, `git push origin main`
  invokes `.githooks/pre-push`, which validates the authoritative remote base
  and runs `./scripts/check_final_integration.sh` once for the exact main tip
  being pushed.
- The pre-push hook rejects a stale or non-fast-forward main update before it
  starts the full gate. Return to the feature worktree, rebase onto the new
  `origin/main`, review the new diff, and rerun affected focused checks before
  attempting integration again.
- If a rebase has conflicts or upstream changes overlap the feature behavior,
  run focused checks for the resolved or overlapping behavior before the final
  main push.

## Integration Back To Main

Once the feature branch is ready:

```bash
git switch main
git fetch origin
git pull --ff-only

# The pre-push hook verifies that this main update is still a fast-forward of
# the authoritative remote main tip, then runs the full integration gate for
# the exact local main commit being pushed.

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
- Integration and conflict resolution must preserve the semantic intent of all involved branches, not just produce text that compiles.
- Before resolving merge or rebase conflicts, review the substantive commits on each side for new features, bug fixes, behavior changes, tests, and user-facing workflows.
- Do not drop, overwrite, or silently weaken current or historical functionality unless the user explicitly approves that product decision.
- If two branches introduce incompatible behavior, surface the product or architecture tradeoff instead of choosing one side silently.
- After resolving conflicts, run focused checks for the affected behavior. The
  full repository gate remains owned by the final main pre-push event.
- If a feature branch has already been pushed and someone depends on it, switch to a conservative coordination flow instead of freely rewriting history.

Recommended Git configuration:

```bash
git config --global rerere.enabled true
git config --global merge.conflictstyle zdiff3
```

### Commit Messages

Use Conventional Commit style for every commit:

```text
<type>(<scope>): <summary>
```

Rules:

- Use a lowercase type. Prefer `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `build`, or `ci`.
- Always include a concise lowercase scope that names the affected area, for example `runtime`, `desktop`, `flower`, `ui`, `gateway`, `installer`, `docs`, or `repo`.
- Keep the summary in imperative mood, start it lowercase, and omit a trailing period.
- Use English for commit messages.
- Examples:
  - `feat(runtime): add startup lifecycle events`
  - `fix(flower): keep thread list order stable`
  - `docs(repo): document commit message format`

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
- For behavior conflicts that are not obvious from conflict markers, inspect the relevant commit history and tests so that fixes and existing product behavior are not regressed.
- If you are not confident about the resolution, abort the rebase and reassess.

## Repository Language Policy

- English is the default language for all maintained repository content.
- Use English for:
  - source code identifiers and source messages where practical;
  - code comments;
  - developer-facing Markdown documents;
  - scripts, examples, fixture descriptions, and troubleshooting notes;
  - test names and assertion descriptions where practical;
  - commit/PR-facing text produced inside this repository.
- Non-English text is allowed only when it is necessary for product internationalization, including:
  - locale dictionaries and localized UI copy;
  - locale metadata such as native language names;
  - localized `README.<locale>.md` files declared in `assets/readme/locales.json`;
  - language-sensitive tests, snapshots, and fixtures;
  - documented examples that explicitly validate Unicode, locale resolution, or translated UI behavior.
- When non-English text is added for i18n, keep it scoped to the relevant locale, resource, or test file and document the reason in English when the purpose is not obvious.

## UI Localization Quality

- Write unambiguous English source copy that names the product surface and user intent. Do not use context-free labels such as `Browser` when the UI means files, or share one translation key across unrelated operations.
- Every shipped non-English locale must provide a complete explicit catalog. Do not assemble localized production dictionaries by spreading `en-US` or another locale and silently inheriting leaf messages.
- Preserve true product names, fixed surface names, documented technical acronyms, and documented fixed English domain terms. In particular, keep the display-mode names `Activity` and `Workbench` unchanged in every locale. Keep Redeven's remote-environment and control-plane domain term `Provider` in English, using the matching `Provider`, `Providers`, `provider`, or `providers` form from `en-US`. AI model providers are a separate generic concept and must be localized according to the locale terminology matrix; use `模型提供商` in `zh-CN`. Localize surrounding generic UI copy and concepts such as runtime, local environment, and control plane.
- User-visible JSX text, titles, tooltips, placeholders, empty states, notifications, and accessibility labels must use i18n keys. User content, AI output, terminal output, filenames, commands, code, and protocol fields remain literal.
- Any identical-English exception must be a named product, a documented technical term, a code literal, or a native same-spelling term. Broad module-level allowlists are not permitted.
- Translation changes must keep dictionary shape, placeholders, rich text, and locale-specific plural forms aligned with `en-US`; Traditional Chinese must not inherit Simplified Chinese copy.
- Each locale requires an independent locale-review subagent instructed to perform native-language-quality review and familiar with developer-tool terminology before integration. The implementation agent must not self-review a locale; the review subagent must compare semantic parity, terminology, naturalness, and protected literals against the canonical source and report actionable findings before approval.

## README Localization Quality

- `README.md` is the canonical `en-US` source. Localized README files mirror its product claims, structure, links, commands, and versioned literals; they must not add locale-only behavior or architecture claims.
- Supported translations live at the repository root as `README.<locale>.md`. Their locale set and order must exactly match the Desktop and Env App language switchers and the manifest in `assets/readme/locales.json`.
- Every README must provide the same native-name language selector, stable section anchors, heading structure, link targets, executable command content, protected product terms, and documented fixed English domain terms. Explanatory prose and shell comments may be localized; commands, flags, paths, URLs, environment variables, protocol fields, version identifiers, and the matching `Provider` term forms remain literal.
- The existing `assets/readme/architecture-overview.png` is the only shared English visual exception. Localized README files must provide localized alternative text and surrounding explanation, and new shared visual exceptions require an explicit manifest entry and review.
- Each non-English README records the canonical source hash, localized content hash, review status, review method, reviewer subagent identifier, and review date in `assets/readme/locales.json`. Any canonical or localized content change invalidates the corresponding review metadata.
- `pending_subagent_review` is allowed only on an unmerged feature branch. Before integration, every non-English README must be marked `reviewed` through an independent `subagent` review, the `reviewed_by` value must identify the locale-review subagent, and `node scripts/check_readme_localizations.mjs --require-reviewed` must pass.
- Run `node --test scripts/check_readme_localizations.test.mjs` and `node scripts/check_readme_localizations.mjs` while editing README translations. Do not weaken structural, link, literal, Traditional Chinese, hash, or review checks to make a draft pass.

## OKF Maintenance Contract

- `okf/` is the only maintained repository knowledge corpus.
- `okf/index.md` is the human entrypoint, `okf/**/*.md` are source concepts, and `okf/dist/` contains generated, committed bundle artifacts.
- When changing architecture, protocols, permission/security boundaries, AI tools, Desktop/runtime/gateway behavior, Workbench interaction contracts, CI, release automation, or public installer behavior, update the corresponding `okf/**/*.md` in the same feature change.
- OKF content must be derived from current source code, tests, generated contracts, and scripts. Do not restore or copy from removed product documents as an authority.
- After changing OKF source files, regenerate and commit `okf/dist/okf_bundle.json`, `okf/dist/okf_bundle.manifest.json`, and `okf/dist/okf_bundle.sha256`.
- Run `./scripts/okf/check_source_integrity.sh` and `./scripts/build_okf_bundle.sh --verify-only` before integration whenever OKF source or bundle output may be affected.
- Do not restore `docs/`, `spec/design/`, `spec/protocol/*.md`, or old root-level product Markdown files.
- The only maintained human-facing non-OKF Markdown files are `AGENTS.md`, `THIRD_PARTY_NOTICES.md`, `README.md`, and the supported `README.<locale>.md` files declared in `assets/readme/locales.json`.
- Machine-consumed Markdown source files named explicitly in `assets/readme/locales.json` are active runtime inputs rather than repository knowledge documents. Do not use that narrow exception to introduce general product or developer documentation outside OKF.
- Machine-readable protocol assets may live outside OKF when they are active source contracts, for example `spec/openapi/*.yaml`.

### OKF Authoring and Information Quality

- Treat each OKF concept as one retrieval unit for one coherent product question, contract, or decision surface. Do not combine unrelated architecture, UI, security, protocol, release, and implementation concerns in one concept.
- Every concept must begin with a concise `# Summary` section that states authority, observable outcome, non-negotiable invariants, and the failure or recovery boundary.
- Keep normative content separate from implementation evidence: summary and contract sections explain what must be true; `# Evidence` records only representative source, test, contract, or script references needed to verify it.
- Do not turn OKF into a source-code inventory. Cite representative evidence instead of enumerating every call site, helper, or historical implementation detail.
- The explanatory body of a normal concept should target no more than 8,000 characters. More than 12,000 characters requires splitting or a concise `quality_exception` frontmatter value justified in the change review. More than 20,000 characters is not acceptable for a normal concept.
- A concept containing more than three independent workflows, owners, or lifecycle domains must be split unless it is explicitly a cross-domain contract.
- Use headings for independent contracts and workflows. Do not place multiple unrelated invariants in one long paragraph.
- Each important boundary has one canonical OKF concept. Other concepts must link to that owner and document only their product-specific delta; do not copy the same prohibition or ownership matrix into multiple files.
- Keep current behavior in concepts. Historical behavior belongs in `okf/log.md` only when it explains a compatibility or migration requirement.
- `okf/index.md` must provide a unique, action-oriented description for every concept and must not list a concept more than once.
- Evidence references must be unique and stable within a concept. New concepts must not use manually maintained numeric citation labels such as `[1]` or `[2]`.
- When an OKF change exceeds its size or scope budget, the same change must split the concept, move evidence into its dedicated section, or record why the exception is necessary.
- Every OKF change must be reviewed for information hierarchy, duplication, stale claims, and retrieval usability in addition to source correctness.

## AI Design Principles

- Prefer prompt-first behavior shaping through prompts and structured contracts.
- Do not add scenario-specific hardcoded heuristics for one-off requests.
- Target generalized orchestration mechanisms rather than stacking special cases.
- Keep important intent and policy decisions observable through events or logs.

## Refactoring Simplicity Principle

- Do not optimize for the smallest patch when a direct local fix would preserve confusing control flow or duplicated state ownership.
- Prefer a coherent refactor that makes the final model simpler, easier to explain, and easier to test, even when it touches more files.
- Avoid over-engineering: introduce a new abstraction only when it removes real branching, clarifies ownership, or turns repeated behavior into one obvious path.
- The desired endpoint is fewer concepts and sharper contracts, not a larger framework around the same ambiguity.

## IMPORTANT Design Constraints

- `IMPORTANT:` comments mark product, security, or interaction invariants that must stay rare, intentional, and backed by code or tests where practical.
- If a change would remove, bypass, weaken, or contradict an `IMPORTANT:` comment, discuss the design impact with the user and receive explicit confirmation before implementing that change.
- Do not work around an `IMPORTANT:` constraint with hidden fallback behavior, alternate entry points, or silent compatibility paths.
- When adding a new `IMPORTANT:` comment, keep it concise, explain the invariant rather than the implementation detail, and add focused test coverage or another enforceable guard whenever possible.

## Published Dependency Policy

- `redeven` is a downstream consumer of `floeterm`, `floe-webapp`, `flowersec`, and `redevplugin`.
- **General capability upstream-first is a hard requirement.** When Redeven needs
  a capability that is reusable, host-neutral, or likely useful across more than
  one product or workflow, implement and release it in the appropriate upstream
  source repository first. Redeven should keep only thin product adapters,
  business orchestration, placement, policy mapping, and UI integration.
- This applies to shared capabilities owned by `floeterm`, `floe-webapp`,
  `flowersec`, and `redevplugin`. Do not turn a general-purpose dependency gap
  into Redeven-local helper code, copied contracts, hidden compatibility shims,
  local package wiring, or one-off product-specific platform logic.
- Never reference local sibling checkouts through package manifests, lockfiles, build aliases, source imports, or Go workspace wiring.
- Forbidden local wiring includes `file:`, `link:`, `workspace:`, `portal:`, relative paths, absolute paths, and equivalent local indirection.
- For ReDevPlugin specifically, a usable dependency update means the matching
  Go module, npm packages, signed Rust runtime artifact, generated contracts,
  compatibility manifest, and contract hashes have all been released together.
  A local `../redevplugin` worktree, branch, copied schema, or draft package is
  not a valid Redeven integration source.
- Required flow for reusable upstream capability work:
  - implement upstream first in the source repository;
  - run that repository's required quality gates;
  - release it;
  - confirm the release artifacts are available;
  - then upgrade `redeven` to the published version;
  - keep Redeven changes limited to product integration and business behavior.

## ReDevPlugin Boundary

`redevplugin` is the reusable plugin platform. It is an independently released
library/runtime repository, not a Redeven source directory, submodule, or
implementation detail. It owns the shared plugin runtime implementation and
publishes versioned Go, TypeScript, Rust runtime, and machine-contract artifacts
for host products to consume.

This section is Redeven's side of the cross-repository contract. Any change that
alters plugin-platform ownership, dependency direction, lifecycle semantics,
runtime supervision, bridge/security mechanics, or generated-plugin boundaries
must update the matching boundary language in `redevplugin/AGENTS.md` in the
same feature and must be reviewed as a cross-repository contract change.
The inverse is also required: when `redevplugin/AGENTS.md` changes the
host/platform responsibility split or the shared Git discipline, review this
section before landing the dependency update in Redeven.

`redeven` is a host product and must consume `redevplugin` through published
artifacts only:

- Go module versions for the embeddable Host library and DTOs;
- npm package versions for the plugin surface host, bridge SDK, generated client,
  and shared UI helpers;
- signed `redevplugin-runtime` release artifacts for each supported platform;
- released OpenAPI, manifest, token/ticket, Rust IPC, WASM ABI, and classifier
  contract hashes.

Redeven integration code should be thin host glue over those released artifacts:
configuration, route mounting, adapter registration, product UI placement,
release-artifact selection, and business capability implementations. Public
plugin-platform mechanics belong upstream in `redevplugin`, including lifecycle
endpoints, package schemas, bridge protocol, storage/network/runtime brokers,
operation/stream envelopes, runtime supervision, generated SDKs, and validators.

The intended dependency shape is library consumption, not source sharing:

- Redeven imports released ReDevPlugin Go packages for Host integration,
  registry/lifecycle APIs, DTOs, adapter interfaces, and mountable HTTP handlers.
- Redeven imports released ReDevPlugin npm packages for plugin surface hosting,
  bridge SDKs, generated clients, and host-neutral UI helpers.
- Redeven bundles a released, signed `redevplugin-runtime` binary selected by
  release metadata for the current platform and channel.
- Redeven references released ReDevPlugin schemas, generated contracts, and
  compatibility hashes. It must not edit, fork, or hand-copy those contracts.
- Redeven contributes product policy and concrete adapters around those
  imports; it does not become a source tree for ReDevPlugin implementation.

The front-end and back-end platform implementation must arrive in Redeven as
released ReDevPlugin library/runtime artifacts, not as Redeven-local platform
code:

- UI platform code comes from released ReDevPlugin npm packages. Redeven may
  place the surface in Env App, Activity Bar, Workbench, Settings, Desktop, or
  CLI workflows, but iframe bootstrap, asset tickets, bridge lifecycle, settings
  and intent SDKs, generated clients, and sandbox-safe UI utilities stay in
  ReDevPlugin.
- Host/back-end platform code comes from released ReDevPlugin Go packages.
  Redeven may instantiate the Host, mount handlers, choose product policy, and
  register adapters, but registry state, lifecycle handlers, permission and
  confirmation enforcement, broker contracts, operation/stream envelopes,
  token/ticket issuance, and stable platform errors stay in ReDevPlugin.
- Backend execution code comes from the released Rust `redevplugin-runtime` plus
  the ReDevPlugin runtime manager/supervisor. Redeven may select and bundle the
  signed artifact, but it must not create a separate runtime process model,
  alternate WASM executor, custom IPC protocol, or host-local hot path for plugin
  storage/network calls.
- Redeven business code begins at adapter registration. Concrete capabilities
  such as containers, files, shells, cloud services, database access, vault
  access, session mapping, and product audit presentation are Redeven logic only
  after the request has passed ReDevPlugin identity, lifecycle, permission,
  confirmation, token, lease/quota, revocation, and audit context construction.

The intended Redeven code shape is a narrow integration layer:

- one or more host packages that configure released ReDevPlugin libraries,
  mount released HTTP handlers, select released runtime artifacts, and register
  Redeven business adapters;
- product UI that places ReDevPlugin surfaces into Env App, Activity Bar,
  Workbench, Settings, Desktop, or CLI flows without replacing the sandboxed
  ReDevPlugin surface lifecycle;
- Flower/Floret orchestration that calls released ReDevPlugin scaffold,
  validate, package, install, enable, open, disable, uninstall, export/import,
  and diagnostics APIs;
- tests that assert Redeven adapter mapping, route mounting, permission
  projection, business-capability behavior, and product UX.

Redeven integration code must not grow into a second plugin platform. Any
Redeven package that starts owning a manifest parser, package builder, registry
state machine, bridge token issuer, asset session manager, WASM executor,
storage/network broker, operation/stream protocol, or runtime supervisor has
crossed the boundary and must be moved upstream into ReDevPlugin first.

Do not use `replace`, `go.work`, `go.work.sum`, local sibling paths,
package-manager links, local npm workspace wiring, Rust path overrides, copied
source trees, or build aliases to point Redeven at a local `redevplugin`
checkout. Do not copy generated `redevplugin` source, schemas, SDK files, or
runtime binaries into Redeven as a substitute for a released dependency. Run
ReDevPlugin dependency and contract checks with `GOWORK=off`.

`redevplugin` owns platform-general concerns:

- plugin package format, manifest validation, signature verification, registry
  schema, staged package lifecycle, and upgrade/downgrade validation;
- plugin lifecycle APIs for install, enable, open, disable, uninstall, update,
  rollback, data retention, export/import, and diagnostics;
- permission evaluation, dangerous-confirmation intents, token/ticket minting,
  bridge protocol, rate limits, audit event contracts, and stable error codes;
- mountable HTTP adapters, sandboxed iframe UI bootstrap, asset serving
  contracts, bridge SDK, and host-neutral settings/intent helpers;
- Rust `redevplugin-runtime`, the released runtime manager/supervisor used to
  launch it, IPC contracts, WASM actor/job execution, storage/network hot paths,
  quotas, target classification, and revocation handling;
- host-neutral CLI, templates, validator, replay harness, contract fixtures,
  and platform test suites.

Redeven owns only product integration and business adapters:

- mounting `redevplugin` HTTP routes into the existing Local UI/AppServer shape
  and preserving Redeven's flat appserver response envelope where required;
- mapping Redeven session metadata, local permission caps, CSRF/origin checks,
  state directories, audit sinks, diagnostics sinks, secret adapters, and release
  artifact resolution into `redevplugin` adapter interfaces;
- integrating plugin surfaces into Env App, Activity Bar, Workbench, Settings,
  Desktop packaging, installer packaging, and runtime startup diagnostics;
- selecting the released `redevplugin-runtime` artifact for the current Redeven
  release and wiring the ReDevPlugin runtime manager into Redeven process
  startup/shutdown without replacing its IPC, lease, quota, or revocation logic;
- registering Redeven-owned business capabilities through
  `redevplugin.CapabilityAdapter` or the released equivalent interface;
- wiring Flower/Floret tools to the `redevplugin` lifecycle APIs without
  bypassing Floret approval lifecycle or ReDevPlugin policy enforcement;
- product-level plugin generation UX: collecting user intent, choosing an
  environment, showing approval/review states, and invoking released
  ReDevPlugin templates, validators, package builders, and lifecycle APIs.

Redeven may add product-facing wrappers such as `redeven plugin ...` commands or
Env App pages, but those wrappers must delegate to released ReDevPlugin APIs.
If a wrapper needs a new platform capability, add and release that capability in
`redevplugin` before wiring it into Redeven.

Before adding any Redeven plugin-related package, classify it in review:

- Host adapter: allowed in Redeven. It maps Redeven sessions, local policy,
  filesystem roots, audit/diagnostic sinks, vault access, product UI placement,
  runtime artifact selection, or a concrete business resource into a released
  ReDevPlugin interface.
- Product wrapper: allowed in Redeven. It exposes a Redeven CLI, Env App,
  Desktop, Activity Bar, Workbench, Settings, or Flower/Floret flow over released
  ReDevPlugin lifecycle APIs and generated clients.
- Platform mechanism: not allowed in Redeven. If the package parses manifests,
  validates packages, mints plugin tokens or asset tickets, serves plugin assets,
  runs plugin WASM, defines broker semantics, stores plugin registry state,
  owns operation/stream protocol, or supervises `redevplugin-runtime`, implement
  and release it in ReDevPlugin first.
- Business capability: allowed in Redeven only as an adapter that is invoked
  after ReDevPlugin has resolved identity, permission, confirmation, token,
  lease/quota, revoke epoch, and audit context.

The default conflict-resolution rule is simple: plugin-platform mechanics live
in ReDevPlugin, Redeven product integration lives in Redeven. If a proposed
Redeven change needs to define a manifest field, package hash rule, bridge
message, token or ticket format, WASM ABI, runtime IPC frame, storage/network
broker behavior, operation/stream envelope, registry state transition, stable
plugin error code, or generated SDK shape, that change belongs in ReDevPlugin
first. If a proposed change needs Redeven's AppServer shape, session metadata,
Workbench placement, Activity Bar UX, Flower orchestration, Desktop packaging,
installer behavior, local policy, secret vault, or a concrete business adapter,
that change belongs in Redeven over an already released ReDevPlugin contract.

Redeven must treat ReDevPlugin as an upstream library/runtime dependency, not as
a co-developed source folder. Integration work may happen in parallel worktrees,
but committed Redeven code must only reference released ReDevPlugin module/npm
versions, released runtime artifacts, and published contract hashes. Do not
land Redeven code that depends on a local ReDevPlugin checkout, an unreleased
feature branch, or a copied contract draft.

Use this responsibility matrix as the default decision rule:

| Area | ReDevPlugin owns | Redeven owns |
| --- | --- | --- |
| Package and trust | Package layout, canonical hashes, signing rules, manifest validation, trust state contracts, compatibility manifests | Which registries or local sources Redeven allows, local policy caps, review UX, and product audit presentation |
| Lifecycle | Install, enable, open, disable, uninstall, update, downgrade, export/import, diagnostics, and data-retention APIs | Env App placement, Desktop commands, Activity Bar/Workbench/Settings entry points, and who may invoke the actions |
| UI runtime | Sandboxed iframe bootstrap, asset ticket/session protocol, bridge SDK, opaque-origin-safe source/port-bound MessageChannel messaging, settings and intent contracts | Native shell chrome, Workbench layout, Settings placement, startup diagnostics, route mounting, and Redeven product copy |
| Backend runtime | Rust `redevplugin-runtime`, runtime manager/supervisor, WASM actor/job model, IPC, leases, quotas, revocation, hostcall contracts, stream envelopes | Selecting and packaging the released runtime artifact, wiring lifecycle hooks into Redeven startup/shutdown, and surfacing diagnostics |
| Storage, network, and secrets | Host-neutral broker contracts, request contexts, target classifiers, quotas, secret reference contracts, and stable errors | State-root selection, vault integration, environment/network policy, proxy settings, and user-facing grant UX |
| Business capabilities | Generic capability adapter interface, permission hooks, operation/stream envelope, and audit DTOs | Docker/Podman, files, shells, cloud services, database access, local product APIs, and other Redeven domain adapters |
| Plugin generation | Templates, validators, package builder, replay harness, generated SDK clients, and example fixtures | Flower prompt orchestration, user intent collection, environment selection, review/approval UX, and generated-plugin install flow |

If a Redeven feature needs a platform behavior that is not represented in the
left column as a released ReDevPlugin contract, stop and add the contract
upstream first. Do not fill the gap by committing a Redeven-local copy of
platform logic.

The clean dependency direction is one-way: Redeven imports released
ReDevPlugin artifacts, and ReDevPlugin never imports Redeven. If a feature needs
Redeven-specific sessions, Env App placement, Flower orchestration, Workbench
chrome, Desktop packaging, installer behavior, local policy, or a concrete
business resource, the feature belongs in Redeven as adapter code over a
released ReDevPlugin contract. If the reusable contract is missing, implement
and release it in ReDevPlugin first rather than filling the gap with a Redeven
copy of platform logic.

Redeven's integration layer must keep the ReDevPlugin platform state opaque:

- Redeven may choose the state root, backup/export destination, audit sink,
  diagnostics sink, and secret-vault adapter, but must not directly edit
  ReDevPlugin registry tables, package staging state, token/ticket rows, storage
  namespaces, runtime leases, or revoke epochs.
- Redeven may configure and launch the released `redevplugin-runtime` through
  the released ReDevPlugin runtime manager and surface its diagnostics, but must
  not fork the Rust IPC protocol, implement an alternate supervisor, inject
  custom hostcalls, run plugin WASM modules in a Redeven-owned execution path, or
  bypass runtime lease/quota/revocation checks.
- Redeven UI may frame host chrome around plugin surfaces and decide where a
  surface appears, but the plugin document itself must be loaded through
  ReDevPlugin sandbox bootstrap, asset-ticket/session validation, and
  opaque-origin-safe source/port-bound MessageChannel bridge handshake. For
  opaque sandbox iframes, `event.origin` is diagnostic context only and is not
  an authorization input; authorization must bind the window source, transferred
  `MessagePort`, asset session, surface instance, bridge nonce, active
  fingerprint, session hash, state version, and revoke epoch.
- Redeven business adapters may call local product services only after
  ReDevPlugin has resolved the plugin identity, session, permission,
  confirmation, token, runtime lease, and audit context for the request.

If Redeven integration reveals a platform contract bug, the durable fix belongs
upstream in `redevplugin` first. Redeven may carry temporary integration
experiments only inside an unmerged feature branch; committed Redeven code must
consume the released ReDevPlugin artifact that contains the fix.

Redeven must not fork or reimplement the plugin platform core under
`internal/plugins`, `internal/codeapp`, Env App UI, CLI commands, or release
scripts. Redeven CLI commands such as `redeven plugin validate` may be thin
wrappers over released `redevplugin` validators, but they must not carry a second
manifest parser, looser validator, separate packaging flow, or alternate install
lifecycle. Redeven tests may use fixtures emitted by released ReDevPlugin
tooling, but must not define a divergent fixture format that becomes a hidden
platform contract.

Redeven integration code must not mint its own plugin gateway tokens, bypass
asset tickets, grant plugin storage/network access outside ReDevPlugin brokers,
load plugin UI outside sandboxed ReDevPlugin surfaces, execute native plugin
backends, or call Redeven business adapters without the ReDevPlugin permission,
confirmation, token, lease, audit, and lifecycle chain.

Containers, if exposed as an official plugin experience, are Redeven business
capabilities. The container capability adapter lives in Redeven, is registered
with `redevplugin`, and must still pass through ReDevPlugin permission,
confirmation, token, lease, audit, and lifecycle contracts. Containers are not a
plugin runtime mechanism and must not be used as a way to run third-party plugin
backends.

Flower-generated plugin flows are Redeven product orchestration over
ReDevPlugin primitives. Flower may draft plugin source, call released
ReDevPlugin validators/builders, ask the user for approval, install and enable
through ReDevPlugin lifecycle APIs, and open the resulting sandboxed surface.
Flower must not write plugin registry rows, mint bridge tokens, place UI assets
directly under Env App routes, bypass package signatures/trust policy, or grant
storage/network/runtime access outside ReDevPlugin brokers.

Upgrading ReDevPlugin in Redeven is a dependency change, not a source sync. The
same feature must update the relevant Go module version, npm package version,
released runtime artifact reference, compatibility manifest or contract hashes,
and local verification scripts together. A Redeven change that depends on
unreleased ReDevPlugin behavior is not ready for integration.

The minimum ReDevPlugin upgrade review in Redeven must answer all of these:

- Which released Go module, npm package, runtime artifact, schema/contract hash,
  and compatibility manifest versions are being consumed?
- Which Redeven adapters are newly registered or changed, and which released
  ReDevPlugin interface do they implement?
- Which product surfaces are added or changed, and how do they still use the
  ReDevPlugin sandbox bootstrap, bridge lifecycle, lifecycle API, and generated
  clients?
- Which business capabilities are exposed, and where are their permission,
  confirmation, operation/stream, audit, quota, and revocation checks enforced by
  ReDevPlugin?
- Which local checks prove the integration uses released artifacts only and does
  not depend on `../redevplugin`, `replace`, `go.work`, local npm links, copied
  contracts, or copied runtime binaries?

Redeven-side plugin code layout must make the adapter boundary visible:

- packages may be named for host integration, route mounting, capability
  adapters, or product UI, but must not be named or structured as a second
  platform core such as `internal/plugins/runtime`,
  `internal/plugins/registry`, `internal/plugins/bridge`,
  `internal/plugins/storage`, or `internal/plugins/network`;
- generated DTOs, schemas, SDK clients, and manifest fixtures must come from
  released ReDevPlugin artifacts. Redeven may wrap them for product UI, but must
  not edit generated ReDevPlugin contracts in place;
- tests in Redeven must prove host adapter behavior, permission mapping, route
  mounting, lifecycle wiring, and product UX. Reusable manifest, package,
  bridge, runtime, storage, network, and lifecycle semantics must be validated by
  released ReDevPlugin tests and fixtures;
- any new plugin-platform concern discovered during Redeven implementation must
  be recorded as a ReDevPlugin upstream requirement before Redeven commits code
  that depends on it.

Use this checklist when reviewing any Redeven plugin integration change:

- Redeven may mount, configure, and observe ReDevPlugin, but must not implement
  an alternate manifest parser, package builder, registry lifecycle, bridge
  token issuer, asset-ticket system, storage broker, network broker, runtime
  IPC layer, runtime supervisor, WASM executor, stream envelope, operation
  manager, or plugin lifecycle state machine.
- Redeven may expose product routes or CLI commands for plugin management, but
  platform-management handlers must be released ReDevPlugin handlers or thin
  wrappers around them. Do not create Redeven-local endpoint semantics that are
  not present in the ReDevPlugin contract.
- Redeven may register business capability adapters such as containers, files,
  shell, cloud, or database access. Each adapter must receive a request context
  that has already passed ReDevPlugin identity, permission, confirmation,
  lease/token, quota, and audit checks.
- Redeven UI may decide where a plugin surface appears, but the iframe document
  must still come from the ReDevPlugin sandbox bootstrap and bridge lifecycle.
  A native Redeven component cannot be called an official plugin surface unless
  it exercises the same sandboxed plugin path.
- Flower may generate plugin source and drive the user-facing install/enable/open
  flow, but it must call released ReDevPlugin scaffold, validate, package,
  lifecycle, and runtime APIs. Flower must not write platform storage directly
  or grant network/storage/runtime access on its own.
- Tests may assert Redeven adapter behavior and route mounting, but reusable
  platform semantics must be covered by released ReDevPlugin fixtures and
  contracts. Do not create Redeven-only fixture formats that become hidden plugin
  platform standards.
- Any plugin-platform TODO discovered in Redeven must be recorded as an upstream
  ReDevPlugin requirement before the Redeven integration can depend on it. Do
  not hide a missing upstream contract behind a Redeven-local helper, internal
  package, undocumented endpoint, or fixture-only convention.
- AGENTS drift is a review blocker. If this section and
  `redevplugin/AGENTS.md` disagree about ownership, dependency direction, Git
  workflow, released-artifact consumption, or the Rust runtime boundary, stop and
  update both files before landing code.

## Flower / Floret Boundary

Redeven consumes Floret only through published `github.com/floegence/floret`
module versions. Do not use `replace`, `go.work`, `go.work.sum`, local sibling
paths, package-manager links, or build aliases to point Redeven at a local
Floret checkout. Run Floret dependency checks with `GOWORK=off`.

Flower and Redeven own product policy, concrete tool implementations, host
thread settings, unadmitted commands, Desktop and Env App adapters, provider
credentials and profiles, provider wire adapters, session grants, filesystem
scope, target routing, approval UX, resource references, read acknowledgement,
and product modes. Redeven presentation is a stateless mapping over Floret public
snapshots plus current-process live drafts bound to exact canonical identity.

Floret owns the reusable Agent lifecycle consumed by Redeven. Its durable
journal, public thread and turn snapshots, turn projections, pending approval
snapshot, context snapshot, and typed Agent todo state are the only authority
for admitted user and assistant conversation, turn/run order and lifecycle,
thread titles, failure and waiting state, control signals, approvals, todos,
provider-visible context, tool identity and lifecycle, Activity projection,
pending settlement, and opaque provider state. Redeven must not persist a
second queryable copy, reconstruct one from audit or transport events, or query
Floret-managed storage.

Redeven code must not bypass those Floret lifecycles:
- tool approval must flow through Floret `PermissionSpec`, resource extraction,
  and `Approver`;
- provider adapters may map provider bytes to Floret `ModelEvent`, but must not
  create durable Flower messages, mutate canonical order, or publish an
  independent activity timeline;
- tool handlers may execute already-approved domain actions, but must not run
  user approval waits or policy deny gates that belong before Floret dispatch;
- control signals must not be registered as ordinary tools;
- `ask_user`, `task_complete`, and custom control signals receive no synthetic
  tool result or Redeven completion gate. Redeven may apply product confirmation
  policy, but waiting and terminal lifecycle remain Floret facts;
- a user command may retain prompt text and queued upload ownership only before
  Floret admission. A committed public Floret turn causes Redeven to atomically
  remove that command and move its uploads to thread ownership; restart
  reconciliation checks the exact opaque `TurnID` through `ListThreadTurns`;
- admitted attachment metadata and opaque `ResourceRef` values live only in the
  Floret canonical user message. Redeven owns upload bytes and thread-level
  resource ownership, resolves those references only in its provider adapter,
  and must not persist admitted `TurnID`/`RunID` attachment mappings or degrade
  resolution failures into filename text;
- Flower history, pagination, thread summaries, waiting presentation, approvals,
  and todos must read `ListThreadTurns`, `ReadThreadOverview`, pending approvals,
  and the typed todo API. Realtime events may carry only in-memory run
  presentation and canonical replacement signals; they must not carry transcript
  messages or a transcript-reset protocol;
- provider adapters may pass `PreviousState` and `ResponseState` only at the
  typed Floret gateway boundary. Floret persists the complete opaque state and
  invalidates it by journal leaf plus the non-sensitive gateway compatibility
  key; Redeven must not persist, clear, match, truncate, or interpret it;
- context usage and compaction are read from Floret `ReadThreadContext` for
  bootstrap and mapped into current-process Flower presentation only. Redeven
  must not persist context lifecycle events or mapped context snapshots;
- Redeven product tables may reference opaque Floret `ThreadID`/`TurnID`/`RunID`
  values, but must not store their content, status, ordinal, projection,
  lifecycle, control, approval, todo, context, provider, or tool-state copies;
- Redeven may retain product-owned audit records for user operations, policy,
  routing, and permissions, but those records must not contain a queryable copy
  of Floret tool state and must never become a Flower UI or evaluation source;
- a Redeven-owned pending process must bind its exact Floret settlement target
  and the creating Host before the process starts. Terminal reads and writes are
  PTY-only operations; final settlement goes once through that bound Host and
  never through run lookup, Host guessing, or a maintenance fallback;
- completed Flower tool status, output, exit code, duration, and errors must
  come from Floret `ThreadTurnProjection` Activity payloads. Redeven process
  reads are allowed only while the corresponding PTY is running;
- activity presentation must use Redeven's `ToolPresentationSpec` projection as
  the single product display policy and must travel with the Floret tool call,
  not as separately persisted presentation state.
- fork calls Floret first and validates only the operation and destination
  identity. Redeven copies host settings and thread-level resource ownership
  without consuming or persisting Floret turn/run rewrite maps or the Floret
  fork result. Delete coordinates product cleanup with Floret public
  `DeleteThread` and never edits or cleans shadow Agent tables.

Flower read state is user scoped. Live thread patches returned through appserver
must carry the current `read_status` when thread activity changes, so a running
thread that stays selected until completion is marked read by the selected
surface while background completions remain unread.

Do not move Redeven product concerns into Floret to satisfy short-term
integration needs. If a future design intentionally changes this boundary, it
must first update the Floret and Redeven public contracts, AGENTS rules, OKF,
tests, and published Floret release notes.

## UI Interaction Affordance

- Any clickable or directly interactive UI control must expose a pointer cursor while it is interactive.
- Do not ship controls that look clickable while still using the default arrow cursor.
- Disabled controls are the exception and must use a clearly non-interactive cursor treatment.

## Runtime Startup Presentation

- `redeven run` startup output must be driven by structured runtime presentation events, not by ad hoc `fmt.Print*` banners inside startup logic.
- Human terminal presentation (`rich` / `plain`) and Desktop/automation presentation (`machine`) are renderers over the same startup lifecycle events.
- Desktop-managed startup must use `--presentation machine` and `--startup-report-file`; Desktop readiness must never depend on parsing human terminal output.
- The compact Redeven character mark belongs in the rich renderer only. Do not reintroduce a separate large startup banner or duplicate brand art in command code.

## Desktop UI Verification

- When testing a `dev_desktop.sh` Desktop build, identify the target app through the script's launched process path, user data directory, or remote debugging endpoint before interacting with it.
- Do not treat the frontmost generic Electron window as the Redeven Desktop target unless its page URL or process arguments prove it belongs to the current worktree.
- If multiple Electron instances are running, prefer the `dev_desktop.sh` CDP endpoint and page URL for automation. A default Electron welcome page is never valid evidence for Redeven Desktop behavior.
- Never use a blank or default Electron window as a verification target for Flower or Desktop behavior. If the visible page is an empty welcome shell, re-check the page URL, process arguments, and CDP target before performing any test action.

## Workbench Wheel Ownership

- Inside Workbench, wheel / trackpad scrolling belongs to the canvas by default. Blank canvas areas and unselected widget bounds may zoom the canvas.
- The currently selected widget boundary is a canvas-zoom guard: wheel events inside the selected widget must never trigger canvas zoom.
- Inside the selected widget, local scrolling is allowed only when the pointer is inside an explicitly marked, real constrained local scroll viewport. Otherwise the wheel event should resolve to ignore/no-op, not canvas zoom and not fake local scrolling.
- Unselected widgets must never capture, consume, or block wheel input. Hover state, visual scroll affordance, embedded lists, or transient focus do not grant wheel ownership.
- Internal controls such as terminals that capture wheel early may consume wheel only when the selected widget and the control's own active/focused state allow local scrolling; otherwise they must suppress their own scroll without forwarding to canvas zoom.
- If a selected widget looks scrollable but does not actually scroll, fix the layout, height chain, and `overflow` viewport structure instead of weakening wheel-routing rules for unselected widgets.
- Production Workbench scroll viewports must use the exported wheel contract props from `workbenchWheelInteractive.ts`; do not hand-write raw wheel data attributes or bypass the static `check:workbench-wheel` gate.

## Workbench Floating UI And Coordinates

- Treat Workbench as a projected coordinate space, not as an ordinary document flow page. Widget surfaces can be translated, scaled, clipped, and hosted inside a local interaction surface, so browser viewport coordinates and surface-local coordinates must not be mixed casually.
- Floating UI inside Workbench, including context menus, dropdowns, popovers, hover cards, tooltips, autocomplete panels, command palettes, color pickers, and date pickers, must use the shared Workbench-safe floating layer contract such as `SurfaceFloatingLayer` or an equivalent existing wrapper. The shared layer owns surface-local projection, clamping, z-index, and local interaction markers.
- Floating panels may own role, focus, keyboard navigation, item layout, and visual styling, but must not own viewport positioning with `position: fixed`, inline `left` / `top`, or `window.innerWidth` / `window.innerHeight` clamping when rendered inside a projected Workbench surface.
- Do not hand-roll viewport-to-surface coordinate conversion in product components by subtracting bounding rects, dividing by scale, adding scroll offsets, or special-casing Workbench transforms. If an existing shared floating layer cannot express the placement, improve that layer or add a small shared wrapper instead of copying coordinate math into each component.
- Do not portal Workbench floating UI directly to `document.body` unless the shared Workbench floating-layer contract explicitly owns that portal path. Body-level portals can bypass surface hosts, local interaction markers, outside-click routing, focus restoration, clipping, and z-index policy.
- Right-click, menu-button, and keyboard-triggered menus must preserve the same interaction contract: open near the pointer or anchor, clamp inside the appropriate surface, support outside click, Escape/Tab close, focus restoration, and keyboard navigation.
- Tests for Workbench-capable floating UI must cover projected or transformed surface placement, not only ordinary page rendering. At minimum, assert that the overlay is hosted by the shared local interaction floating layer and that the panel itself does not receive fixed viewport coordinates.

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

Validation has three explicit levels:

- During implementation, run focused checks for changed behavior and affected
  contracts.
- `.githooks/pre-commit` is intentionally fast. It runs staged diff validation,
  the README localization contract, and staged open-source hygiene only. Do not
  add asset builds, full product suites, Docker E2E, or repository-wide tests to
  pre-commit.
- `.githooks/pre-push` owns the complete local integration gate for updates to
  remote `main`. It requires the checked-out local `main` tip to match the push,
  requires the remote tip to be its ancestor, rejects merge commits in the
  unpublished range, and invokes `./scripts/check_final_integration.sh` with the
  exact base and tip commits. Other branch and tag pushes do not run the full
  gate.

`scripts/check_final_integration.sh` is the single executable source of truth
for the complete local gate. It requires a clean worktree and exact `HEAD`, then
runs diff validation, shell syntax, notices, README localization enforcement,
Git-hook contracts, UI lint and behavior checks, release and compatibility
contracts, dependency boundaries, embedded asset generation, ReDevPlugin and
Gateway integration, Flower checks, full Desktop Vitest coverage and build,
Docker Runtime E2E, repository hygiene, OKF verification, Go tests, and
golangci-lint. Local Go package tests run serially with the test cache disabled
before the heavier UI and Desktop stages, so wall-clock-sensitive integration
tests do not compete with other Go packages and failures stop the gate early. It
fails if any check changes the worktree.

Commands with explicit full modes, especially
`./scripts/check_desktop.sh --full`, belong only in the final integration script
and must not be used as routine iteration checks. GitHub Actions keeps its
documented lightweight Desktop coverage and independently validates the pushed
main commit.

## Repository Rule File

- `AGENTS.md` is the canonical repository rule file for this repository.
- Do not add or keep a committed repository-level `.develop.md` here.
