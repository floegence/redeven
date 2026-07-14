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

After every rebase:

```bash
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
- Integration and conflict resolution must preserve the semantic intent of all involved branches, not just produce text that compiles.
- Before resolving merge or rebase conflicts, review the substantive commits on each side for new features, bug fixes, behavior changes, tests, and user-facing workflows.
- Do not drop, overwrite, or silently weaken current or historical functionality unless the user explicitly approves that product decision.
- If two branches introduce incompatible behavior, surface the product or architecture tradeoff instead of choosing one side silently.
- After resolving conflicts, run focused checks for the affected behavior in addition to the repository quality gate.
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
- Each locale requires review by a native speaker familiar with developer tools before release. Automated checks are necessary but are not a substitute for linguistic sign-off.

## OKF Maintenance Contract

- `okf/` is the only maintained repository knowledge corpus.
- `okf/index.md` is the human entrypoint, `okf/**/*.md` are source concepts, and `okf/dist/` contains generated, committed bundle artifacts.
- When changing architecture, protocols, permission/security boundaries, AI tools, Desktop/runtime/gateway behavior, Workbench interaction contracts, CI, release automation, or public installer behavior, update the corresponding `okf/**/*.md` in the same feature change.
- OKF content must be derived from current source code, tests, generated contracts, and scripts. Do not restore or copy from removed product documents as an authority.
- After changing OKF source files, regenerate and commit `okf/dist/okf_bundle.json`, `okf/dist/okf_bundle.manifest.json`, and `okf/dist/okf_bundle.sha256`.
- Run `./scripts/okf/check_source_integrity.sh` and `./scripts/build_okf_bundle.sh --verify-only` before integration whenever OKF source or bundle output may be affected.
- Do not restore `docs/`, `spec/design/`, `spec/protocol/*.md`, or old root-level product Markdown files.
- The only maintained non-OKF Markdown files are `AGENTS.md`, `README.md`, and `THIRD_PARTY_NOTICES.md`.
- Machine-readable protocol assets may live outside OKF when they are active source contracts, for example `spec/openapi/*.yaml`.

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

Flower and Redeven own product policy, concrete tool implementations, durable
threads, canonical Flower timeline projection, Desktop and Env App adapters,
provider credentials, provider profiles, provider-specific persistence, session
grants, filesystem scope, target routing, approval UI, and product modes.

Floret owns the reusable agent-engine lifecycle consumed by Redeven: provider
loop execution, tool dispatch lifecycle, tool permission/resource/approval
lifecycle, runtime streaming observation, core control-signal handling, and
opaque model state lifecycle.

Redeven code must not bypass those Floret lifecycles:
- tool approval must flow through Floret `PermissionSpec`, resource extraction,
  and `Approver`;
- provider adapters may map provider bytes to Floret `ModelEvent`, but must not
  mutate Flower run state, assistant blocks, cursor state, transcript rows, or
  activity timeline directly;
- tool handlers may execute already-approved domain actions, but must not run
  user approval waits or policy deny gates that belong before Floret dispatch;
- control signals must not be registered as ordinary tools;
- Flower waiting prompts and persisted product UI actions may only be created in
  the Redeven waiting projection/persistence layer, not while projecting a
  Floret control signal;
- provider continuation state must be persisted as the complete opaque Floret
  model state envelope, including `Attributes`; Redeven may match provider,
  model, base URL, and state kind, but must not truncate or interpret the
  opaque attributes;
- Redeven tool execution records, `ai_tool_calls`, run events, and execution
  spans are audit/query records only. Flower UI tool activity must come from
  Floret `ActivityTimeline` projection, with any detail lookup keyed from that
  timeline rather than generated from audit tables;
- activity presentation must use Redeven's `ToolPresentationSpec` projection as
  the single product display source.

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

Run the CI-aligned checks and local-only pre-commit checks before integration:

- `sh -n scripts/install.sh`
- `sh -n scripts/generate_release_notes.sh`
- `bash -n scripts/test_generate_release_notes.sh`
- `bash -n scripts/lint_ui.sh`
- `bash -n scripts/build_desktop_bundled_runtime.sh`
- `bash -n scripts/build_desktop_bundled_agent.sh`
- `bash -n scripts/check_desktop.sh`
- `bash -n scripts/check_docker_runtime_e2e.sh`
- `bash -n scripts/check_gateway_protocol_contract.sh`
- `bash -n scripts/check_redevplugin_dependency_boundary.sh`
- `bash -n scripts/check_redevplugin_release_artifacts.sh`
- `bash -n scripts/check_redevplugin_consumption_gate.sh`
- `bash -n scripts/stage_redevplugin_release_artifacts.sh`
- `bash -n scripts/check_plugin_integration.sh`
- `bash -n scripts/check_runtime_compatibility_contract.sh`
- `bash -n scripts/check_flower_live_protocol.sh`
- `bash -n scripts/check_flower_ui.sh`
- `bash -n scripts/ui_package_common.sh`
- `bash -n scripts/open_source_hygiene_check.sh`
- `bash -n scripts/install_git_hooks.sh`
- `bash -n .githooks/pre-commit`
- `node scripts/generate_third_party_notices.mjs --check`
- `./scripts/lint_ui.sh`
- `./scripts/test_generate_release_notes.sh`
- `./scripts/check_runtime_compatibility_contract.sh --source-only`
- `./scripts/check_redevplugin_dependency_boundary.sh --ci`
- `./scripts/check_redevplugin_release_artifacts.sh --self-test`
- `./scripts/check_redevplugin_consumption_gate.sh --self-test`
- `./scripts/stage_redevplugin_release_artifacts.sh --self-test`
- `./scripts/check_plugin_integration.sh --ci`
- `./scripts/check_gateway_protocol_contract.sh`
- `./scripts/check_flower_live_protocol.sh`
- `./scripts/check_flower_ui.sh`
- `./scripts/check_desktop.sh`
- `./scripts/check_docker_runtime_e2e.sh`
- `./scripts/open_source_hygiene_check.sh --staged`
- `./scripts/open_source_hygiene_check.sh --all`
- `./scripts/okf/check_source_integrity.sh`
- `./scripts/build_okf_bundle.sh --verify-only`
- `./scripts/build_assets.sh`
- `go test ./...`
- `golangci-lint run ./...`

## Repository Rule File

- `AGENTS.md` is the canonical repository rule file for this repository.
- Do not add or keep a committed repository-level `.develop.md` here.
