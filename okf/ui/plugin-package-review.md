---
type: UI Contract
title: Plugin package review
description: Review official updates and external packages against exact Host-verified source and permission evidence.
tags: [ui, plugins, review, lifecycle]
timestamp: 2026-09-08T00:00:00Z
---
# Summary

ReDevPlugin owns package inspection, validation, and atomic lifecycle mutation. Redeven presents the exact candidate, source evidence, permissions, and confirmation before submitting through released APIs. Cancellation affects only pre-submit inspection. Unknown mutation outcomes require inventory reconciliation instead of resubmission. Updates retain saved components and use fresh authorized slots after reconciliation; only confirmed uninstall removes their placement.

# Contract

## Update review and confirmation

Plugin Center's Updates card and inspector expose one primary `Review update`
action. Opening it creates an exact update intent, shows the loading review in
the same interaction, and never submits a mutation, changes tabs, or replaces
the current selection. For an official plugin, that loading state waits for the
Shell's single market-then-inventory refresh, relocates the exact inventory key,
and inspects only the refreshed release source. A missing item, changed source,
changed generation during inspection, stale cache, or unavailable market stops
the check and exposes one retry; none may produce `no update`. External plugins
retain their explicit source-entry flow. Open remains a mode-independent overflow action while an update is available. The dedicated
update dialog owns source-required, loading-review, review, installing,
reconciling, and complete states. Its fixed footer always exposes an explicit,
single-line target action such as `Update to vX`, `Install new build`, or
`Replace current build`; low-height and narrow layouts scroll only the body.

The immutable update candidate binds the exact plugin instance, management
revision, current and target versions, package, manifest, entries, contract-set,
and summary hashes. Before install, Redeven rechecks the current inventory
revision and market generation. A changed target is stale and requires a fresh
review; it is never silently substituted. Version upgrades, same-version external replacements,
exact-package no-ops, and downgrades are projected centrally rather than inferred
separately by cards and dialogs.

Official security declarations come only from the market preview generated from
the final package and exact capability contracts; installation is the final
verification authority. Redeven does not maintain
official-plugin release notes or synthesize publisher notes from manifests,
source history, plugin identity, or host locale catalogs. Missing publisher notes
remain visibly absent.

Install starts only from the review footer. Development builds and external
replacements require a concise adjacent risk acknowledgement; ordinary verified
version upgrades need no redundant checkbox. Source inspection and official
review preparation remain cancellable through both the header close control and
footer Cancel action; closing aborts the exact in-flight inspection and cannot
publish a late candidate. Once mutation submission begins, installing and
reconciling prevent close and duplicate submission because hiding an observer
must not be presented as cancelling a durable Host operation. The Host rebinds
the exact owner/session and revalidates the exact
bytes and expected hash before its atomic control-database transaction. An unknown
transport outcome retires stale UI authority and requires inventory refresh; it
does not create receipt/query state or resubmit the mutation. Successful install
remains in a complete dialog until the user chooses Open, permissions,
or Done. Inventory refresh failure is reported separately from mutation failure.
Closing completion preserves the Updates tab, clears obsolete exact selection,
and shows an `All plugins are up to date` success state when no updates remain.

## External package review

Administrators may start installation or update from a compatible public HTTPS
package URL, public GitHub repository Release with optional tag, or local
`.redevplugin` file. The product submits the source and intent to the released
inspection API; it never downloads remote bytes in the browser, parses the
package, chooses trust state, or invents provenance.

An official Discover action uses the exact signed release reference from the
validated market snapshot. Redeven passes the matching immutable GitHub Release
transport to ReDevPlugin and never downloads package bytes in the browser. If
the market is unavailable, installed plugins remain visible and usable while
discovery and release installation show one retryable unavailable state. An
invalid or expired official release never falls back to external-package review.

Update source entry preserves only reusable public identity. GitHub may prefill
its public repository, while package URLs and uploads require fresh input. Every
update remains bound to the exact instance and management revision.

The opaque review dialog exposes four compact visible stages: source, security
review, install, and done. Review starts with immutable plugin identity, a
concise source identity, and one plain-language trust decision. The primary UI
does not expose execution-approval field names or reason codes. It explains why
the exact package requires confirmation; full approval state and reason evidence
remain in the initially collapsed report. Invalid, revoked, and policy-blocked
results remain top-level blocked decisions. Absent, unknown-signer, and
temporarily unavailable signatures remain top-level caution decisions that
require exact-package confirmation. Verified, user-approved, and policy-approved
assessments still require product confirmation and never imply a permission grant.

The review presents one outcome-led access and operation-impact summary instead
of separate permission and method inventories. Host permission declarations are
shown only as a protected-access count in that summary. Methods are grouped by
the released `read|write|execute|delete|admin` effect set, never as granted
permissions or completed actions. Dangerous methods remain prominent regardless
of effect, and an unrecognized runtime value fails visible as an additional
high-attention group. Raw permission identifiers, method names, effects, routes,
preflight, confirmation, and contract facts remain in the complete report.
Network destinations, worker artifacts, secret references, and contract-proven
storage writes use observable capability language without inferred business
purpose.

The next review level shows declared worker code, external destinations, secret
references, operation-impact groups, core actions, and every sensitive added or
changed update declaration. An update also shows the total added, changed, and
removed count before confirmation and explicitly says when declared access is
unchanged. If no permission or operation is declared, each empty state remains
separate and makes no claim that the plugin is safe, trusted, or authorized. The
complete Host inspection report is always initially closed;
its entry carries the update-change count, and an explicit open expands the
categories containing added or changed declarations while removed-only and
unchanged categories remain closed. The report retains the complete Host source
provenance, inspection id, expiry, intent, signature, execution approval, update
eligibility, reason codes, security summary by category and item, package,
manifest, entries, and security-summary hashes, and confirmation digest.
Progressive disclosure changes prominence only and never removes authoritative
inspection facts. Policy-blocked results retain their exact reason codes instead
of collapsing into an unsigned-package warning.

The exact-package confirmation control stays in the fixed action footer and
remains visible while the review body scrolls. Its concise decision copy does
not repeat the confirmation digest; the complete report retains that exact
evidence. First install confirmation states that the Host will persist the
plugin as enabled without silently granting permissions. Update or reinstall
confirmation states that the Host retains enabled state and existing grants and
adds no grants automatically.

Invalid, revoked, or policy-blocked assessment disables install. Absent,
unknown-signer, and temporarily unavailable signatures show a prominent risk
state but may be explicitly confirmed. Install is unavailable until confirmation,
and the dialog cannot close while the Host mutation is in flight. An update closes
its visible slots before install; failure to close blocks the mutation. Unknown
outcome retires the stale management revision until authoritative inventory is
reloaded, so queued stale opens cannot pass.
After a fresh install, the plugin is visibly enabled; missing required grants
are shown as permission attention and block only the affected open or capability
call. After an update or reinstall, completion reads the authoritative inventory
record, retains existing grants, and claims only that no new grants were added.
Manual updates remain the default unless verified evidence allows automatic
updates. Equal SemVer never proves latest: equal package hashes offer exact-package
reinstall, different hashes warn that content differs, and missing prior hash
states that equality cannot be determined. Every case remains bound to the
exact update intent and inspection digest. The completion action enters
the exact installed detail for permission review. A refresh
failure after a terminal install exposes only an inventory refresh recovery and
never a second install action.

# Boundaries

[Plugin surfaces](plugin-surfaces.md) owns discovery and management navigation.
[Plugin layout continuity](plugin-layout-continuity.md) owns container persistence.
Inspection and commit always bind released Host identities. Review cannot accept
stale candidates, infer permission from source trust, or replay an uncertain update.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginUpdateReviewDialog.tsx:1` - Owns update review and result presentation.
- `redeven:internal/envapp/ui_src/src/ui/plugins/ExternalPluginInstallDialog.tsx:1` - Owns explicit external-source admission UI.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginUpdateProjection.ts:1` - Binds exact update target and candidate identity.
- `redeven:internal/envapp/ui_src/src/ui/plugins/externalPluginSecurityProjection.ts:1` - Projects permission and security evidence.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginManagement.browser.test.tsx:1` - Verifies responsive review and confirmation behavior.
