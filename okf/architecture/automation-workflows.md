---
type: Architecture Contract
title: Scheduled workflows and shared Flower work
tags: [automation, flower, scheduling, context, plugins]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Automation owns definitions, context and artifacts; ReDevPlugin owns durable scheduling and published agent.work. Canonical Floret owns admission, execution, approval and observation, with no second model runtime. Tessiven business linkage is deferred.

# Contract

## Definition and authorization

Ownership comes from the authenticated user and Environment, never request fields. Drafts grant no execution; incomplete drafts use revision compare-and-swap. Publication validates the DAG, model, directory, tools and result schemas and requires an explicit expiring grant. Republishing retains prior run grants; revoke disables every version.

Runs pin publication, purpose, scheduled time and request identity. Repeated requests return their receipt; changed payloads conflict. Receipt reads authorize no new effects. Changed drafts require publication before Run or schedule enablement. Archive retains history and stops admission.

Before admission/effects, reconstruct authority from the versioned grant and current Environment cap. Channel-free effects require an owner-bound thread and current delegation, never just an automation label. Interactive effects still require channels. Persist no bearer/admin/platform-model/Desktop authority; background models exclude interactive platform/Desktop sources. Revocation fences effects and requests canonical cancellation.

## Scheduling

Published scheduling owns interval/completion-relative/daily IANA-timezone cadence, missed/overlap policies, bounded queue, claim identity and recovery. Plans pin immutable publications. Preview uses the same calculation without enabling. Pause changes future scheduling independently of unsaved edits and retains admitted work.

Scheduler claim IDs are product run request IDs. Dispatch checks plan revision, publication and authority. Lost responses reconcile against retained admissions; known runs are never resubmitted. Only absence of that exact request in the exclusive workflow store proves not_committed. Unknown canonical effects remain unknown; error wording never establishes retry safety.

## Execution and context

Nodes support fixed tools, Flower, bounded parallel items, conditions, joins, HTML and local artifacts. Structured results expand stable item IDs. Partial joins require minimum success and retain gaps. Retry preserves successful siblings, invalidates descendants and never replays unknown effects without reconciliation. Admissions recheck cancellation/deadline/dependencies; cancellation stays monotonic through authorization.

One run-level context revision spans goal, pinned definition, scheduled time, findings, decisions, results, requirements and source uncertainty. Bounded briefs reference paged contributions/materials; external content grants no authority. Contributions name the actual attempt/read basis; changed content under repeated IDs conflicts. New requirements retain history, invalidate stale results/artifacts and fence late outputs.

Flower nodes use separate execution threads with shared workflow context. Canonical ThreadModelContext snapshots and UsedAt/UsedByRequestID prove loaded context; briefs alone do not. Mutation receipts are compact; evidence requires explicit reads. Results remain candidates until canonical success and output-schema validation.

Fixed HTTP reads use the existing host transport, no ambient headers, no redirects, a 25-second deadline and a 48-KiB body bound. Container reads use the existing product resource adapter. HTML rendering uses escaped Go templates with an enforced 2-MiB output bound. Artifacts retain content, digest and context revision; previews use sandboxed frames with restrictive document policy. Delivery currently saves a local retained artifact, not email or remote publication.

## Unified Flower profiles and plugin work

flowerwork resolves one owner-bound thread profile: plugin authoring, Tessiven design, workflow design/execution or plugin analysis. Profiles supply guidance, tools, skills, result contracts and context references. Product stores retain lifecycle; Floret retains history, without a parallel ledger. Ordinary chats expose no owner-specific tools.

Workflow design can read/save a draft but cannot enable execution. Run threads reject ordinary chat mutations, fork, retry, queue, goals, subagent, computer and upload takeover; the workflow surface owns their controls. Every tool still rechecks runtime permissions and the original run grant. Floret input is explicitly disabled for unattended work; its optional Goal capability also obeys the exact run allowlist. Built-ins cannot widen the final provider surface.

Installed plugins use published agent.work through the platform bridge. Retain its exact binding; revalidate instance/fingerprint/revisions/permissions/expiry before continuation. Plugin owner fields/new bindings cannot renew authority. Each request creates visible host review and permits at most one run after user model/directory selection and authorization. Analysis uses provided materials without arbitrary tool grants; author preview cannot borrow installed-host authority.

## Persistence and lifecycle

StateDir/apps/automation/workflows.sqlite is Redeven-owned and process-locked. Schema 1 to 2 preserves grants by publication version; 2 to 3 recovers the draft/publication revision relationship from retained definitions. Changed drafts remain unpublished. Migration is atomic and verified before service readiness; unsupported state remains unchanged. The schedules.sqlite store is opaque and migrated by the published scheduler. Floret thread storage remains opaque.

Shutdown stops scheduling, drains the controller, stops AI execution, then closes product stores. Model-service generations are acquired through the existing readiness lease, not retained across replacement.

# Boundaries

The independent canvas offers a DAG, inspector, undo/redo, draft recovery, explicit CAS version review, keyboard controls, zoom/fit, narrow layouts, schedule history, run/context inspection and artifacts. Conflicts retain drafts and require reviewing the saved version before rebasing an edit; replacing a draft is undoable, and later concurrent writes still conflict. Delayed loading/saving preserves newer edits; polling cannot regress a run revision. Artifact downloads use authenticated session transport. Local drafts and disconnected intent records grant no execution authority. Every locale owns its copy.

# Evidence

- internal/automation: definitions, migrations, shared context, grants and deterministic engine tests. internal/codeapp/automation_migration_test.go verifies real service startup/restart from schemas 1/2, unpublished drafts, retained publications/grants and byte-identical rejection of unsupported state.
- internal/flowerwork and internal/ai/automation*: profile resolution, canonical execution, isolation and real-provider qualification.
- internal/codeapp/automation*: current-policy authorization, fixed tools and scoped scheduled-report qualification.
- internal/redevpluginintegration/agent_work*: installed-host capability adapter, review and revocation tests.
- internal/envapp/ui_src/src/ui/automation: canvas, API contracts and browser acceptance tests.
