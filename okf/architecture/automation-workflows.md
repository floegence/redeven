---
type: Architecture Contract
title: Scheduled workflows and shared Flower work
tags: [automation, flower, scheduling, context, plugins]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Automation owns versioned definitions, business context and artifacts. ReDevPlugin owns durable scheduling and the published agent.work capability. Flower uses canonical Floret admission, execution, approval and observation; neither the canvas nor the workflow engine creates a second model runtime. Tessiven business linkage is outside this feature.

# Contract

## Definition and authorization

An owner is the authenticated user and Environment, never a request-supplied field. Draft creation grants no execution. Incomplete drafts can be saved with revision compare-and-swap; publication validates the complete DAG, model, directory, tool names and result schemas. Each immutable publication has an explicit expiring grant. Later publication retains earlier run grants; explicit revoke disables every version.

Each run pins a publication, purpose, scheduled time and stable request identity. Repeating the same request returns its receipt; changing its payload conflicts. Reading an admitted receipt does not reauthorize new effects. Saved changes to a published draft require publication before the primary Run action or schedule enablement. Archive preserves history and stops new admission.

Background authority is reconstructed from the versioned grant and current Environment permission cap before admission and each effect. Channel-free effects require an owner-bound execution thread and matching current delegation; the automation session label alone grants nothing. Ordinary interactive effects still require a channel. No interactive bearer, admin bit, platform model token or Desktop authority is persisted. Background model choices exclude interactive platform and Desktop model sources. Revocation blocks further effects and requests cancellation through the canonical runtime.

## Scheduling

The published scheduler owns interval, completion-relative and daily IANA-timezone cadence, missed-run policy, overlap policy, bounded queue, durable claim identity and recovery. Product configuration binds one immutable publication. Preview calls the same cadence calculation without enabling a schedule. Pause changes future scheduling independently of unsaved canvas edits and does not cancel admitted work.

The scheduler claim ID is the product run request ID. Dispatch checks current plan revision, publication and authorization. A lost dispatch response is reconciled against the retained product admission; a known run is never resubmitted. Product inspection reports not_committed only when the exclusive local workflow store has no admission under that exact request. Unknown canonical execution effects remain unknown, never inferred safe from an error message.

## Execution and context

Nodes support fixed tools, Flower work, bounded parallel items, conditions, joins, HTML rendering and local artifact delivery. Dynamic expansion uses structured results and stable item IDs. Partial joins require a minimum-success policy and retain gaps. Retry preserves successful siblings and invalidates descendants. Unknown effects require reconciliation, never blind replay. Each retained admission checks cancellation, deadline and current dependencies; cancellation is monotonic, including during authorization.

All nodes share one run-level context revision: goal, pinned definition, scheduled time, findings, decisions, results, user requirements and source uncertainty. Bounded briefs point to paged contributions and provided materials. External contents are data, never authority. Contributions identify the actual attempt and read basis; repeated IDs with changed content conflict. Requirement changes retain historical evidence while invalidating stale results and artifacts. Late work cannot replace the new requirement's outputs.

Each Flower node has its own execution thread and shared workflow context. Canonical ThreadModelContext snapshots and UsedAt/UsedByRequestID identify loaded context; a brief alone is not a read receipt. Mutation acknowledgements are compact; evidence is fetched explicitly. Submitted results remain candidates until canonical execution succeeds and the output schema validates. The engine never manufactures success.

Fixed HTTP reads use the existing host transport, no ambient headers, no redirects, a 25-second deadline and a 48-KiB body bound. Container reads use the existing product resource adapter. HTML rendering uses escaped Go templates with an enforced 2-MiB output bound. Artifacts retain content, digest and context revision; previews use sandboxed frames with restrictive document policy. Delivery currently saves a local retained artifact, not email or remote publication.

## Unified Flower profiles and plugin work

The flowerwork registry resolves exactly one owner-bound profile for a thread: plugin authoring, Tessiven design, workflow design, workflow execution or plugin analysis. A profile supplies guidance, relevant tools, skills, result contract and business context references. Existing product stores own lifecycle and canonical Floret owns conversation history. There is no parallel work ledger. Ordinary chats do not expose owner-specific tools.

Workflow design can read/save a draft but cannot enable execution. Run threads reject ordinary chat mutations, fork, retry, queue, goals, subagent, computer and upload takeover; the workflow surface owns their controls. Every tool still rechecks runtime permissions and the original run grant. Floret input is explicitly disabled for unattended work; its optional Goal capability also obeys the exact run allowlist. Built-ins cannot widen the final provider surface.

Installed plugins use the released agent.work contract through the ordinary platform bridge. The host retains the exact platform-issued binding and revalidates instance, fingerprint, revisions, permissions and expiry before continuation. Plugin-supplied owner fields or new bindings cannot renew retained authority. One plugin request creates a visible host review item and permits at most one run. The user selects model/directory and explicitly authorizes execution. Plugin analysis accepts provided materials only, with no arbitrary tool grant. The author preview environment does not borrow installed-host authority.

## Persistence and lifecycle

StateDir/apps/automation/workflows.sqlite is Redeven-owned and process-locked. Schema 1 to 2 preserves grants by publication version; 2 to 3 recovers the draft/publication revision relationship from retained definitions. Changed drafts remain unpublished. Migration is atomic and verified before service readiness; unsupported state remains unchanged. The schedules.sqlite store is opaque and migrated by the published scheduler. Floret thread storage remains opaque.

Shutdown stops scheduling, drains the controller, stops AI execution, then closes product stores. Model-service generations are acquired through the existing readiness lease, not retained across replacement.

# Boundaries

The independent canvas offers a DAG, inspector, undo/redo, draft recovery, explicit CAS version review, keyboard controls, zoom/fit, narrow layouts, schedule history, run/context inspection and artifacts. Conflicts retain drafts and require reviewing the saved version before rebasing an edit; replacing a draft is undoable, and later concurrent writes still conflict. Delayed loading/saving preserves newer edits; polling cannot regress a run revision. Artifact downloads use authenticated session transport. Local drafts and disconnected intent records grant no execution authority. Every locale owns its copy.

# Evidence

- internal/automation: definitions, migrations, shared context, versioned grants, schedule adapter and deterministic engine tests.
- internal/flowerwork and internal/ai/automation*: profile resolution, canonical execution, isolation and real-provider qualification.
- internal/codeapp/automation*: current-policy authorization, fixed tools and scoped scheduled-report qualification.
- internal/redevpluginintegration/agent_work*: installed-host capability adapter, review and revocation tests.
- internal/envapp/ui_src/src/ui/automation: canvas, API contracts and browser acceptance tests.
