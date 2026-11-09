---
type: Runtime Contract
title: Service template marketplace discovery and acquisition
tags: [architecture, templates, marketplace, acquisition, desktop]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

The market discovers passive evidence. Deployment requires exact originals acquired through Desktop or Runtime.

# Contract

## Discovery and authority
Existing `redeven-plugin-market` Worker discovers `redeven-service-template` GitHub topics; no new registry or local format. Published SDK finds root/direct `templates/<name>` documents. Default branch tracks updates; changed directory bytes require higher revision. Record confirmed unavailability, retain evidence on observation failure. Classification grants no execution trust.

Reserved interactive-desktop capabilities require all original bytes/modes to match published official manifest. Immutable metadata retains authorization across upgrades; reopening verifies digest. New privileged definitions require upstream release.

GET `/managed-web-service-templates/market-catalog` reads cache with read permission; explicit/open-discovery POST refresh requires full permission. Validate complete ordered generation, identity/presentation, redirects/regressions/pages before atomic replacement. Failure retains old evidence; environment identity fences replies. Official/community use same verified catalog and pinned flow. Discovery defaults all deployment types. Official/Community/My templates are explicit views; My templates contains accepted Git and user-authored sources. Embedded bytes only resolve legacy instances/exact runtime-profile authority, never new browsing/deployment. Preserve instance/source bindings; market refresh cannot overwrite builtins or upgrade instances.

## Acquisition and deployment
Market Deploy immediately opens configuration and acquires the owner-scoped immutable 15-minute review shared with imports. No extra review/Continue dialog. Expandable source/digest/execution evidence and required notices support final Deploy authorization. Pin numeric repository ID/commit/directory digest through Desktop transfer or Runtime acquisition; Runtime independently revalidates originals. API `source` contains repository/ref/path only; resolved identity belongs in `expected`/`snapshot.source`, rejected elsewhere.

Published v0.8.2 anonymous pinned reads use exact-commit codeload archives without REST quota. Preserve expected repository ID; validate commit metadata/every byte/mode against digest. Upstream bounds/paths/collisions/LFS/unsupported-entry rules fail closed, with no extraction/retry/API fallback/moving-ref substitution. Credentialed/unpinned reads use GitHub API with API-only request-scoped credentials and no redirects. Discovery/review/preparation saves no executable source and runs no lifecycle action.

Final install atomically commits source acceptance/binding/service/forward/receipt. Unknown admission reconciles without replay. Source/preflight/prerequisite failures remain in same drawer with explicit Retry. Existing instances/pending requests visibly block submission. Expired-source retry retains exact market identity, selected release and draft, including rejected submission. Cancel/environment change fences acquisition. Fixed buttons show busy without new loading/feedback rows; errors overlay footer. Final submit creates visible progress before receipt.

## Browsing and identity
Use published taxonomy All types/Host/Container/Docker Compose; semantic categories require upstream format, never infer from names. Active service records by exact template ID own installed/open/submission state, independent of template catalog. Stopped active records count; detached/personal copies cannot mark another template. SDK numeric repository/document namespace owns Git identity, no builtin aliases/display-name guesses. New workspaces: `<writable root>/Redeven/workspaces/managed-services/<template ID>/<instance suffix>`; retain saved paths. Preflight/final admission enforce family uniqueness across competing requests.

Search combines whitespace terms and Unicode width/case over displayed/all-localized names/descriptions, document/repository/path/default release. Source/type facets compose; counts apply source/search before type. Empty results reset to complete discovery. Refresh, including successful empty, preserves query/category/requested identity; environment fences replies. Stale/error feedback uses fixed refresh tooltip/live description under [continuity](../ui/page-loading-continuity.md), no new row. Save/import opens cleared My templates.

Separate navigation, search/actions and facets. Wrap names/categories, clamp descriptions to two lines; list/detail scroll leaves Deploy reachable. Remote details show evidence; configuration follows acquisition. Floe keyboard controls and Official/Community grouping preserve ownership. Cover four official entries without bundled duplicates, search/facets, create/import, review/admission fences, locales and 320–1440px; Runtime covers legacy lifecycle/capabilities.

# Boundaries

Upstream owns acquisition/parsing/compatibility/byte checks; product owns UI/authorization/lifecycle. Editor writes current spec v7; old read compatibility does not allow v6 API writes. [Template publication](managed-web-service-templates.md) owns retained source formats.

# Evidence

- `internal/templatemarket/service_test.go`: complete generation/identity/cancel/stale cache. `internal/portforward/registry/template_versions_test.go`: migration/rollback. `internal/managedwebservice/template_{market_acceptance,source_profile,market_native,official_acceptance}_test.go`: exact review/pins/recovery/full original modes and opt-in Host/Docker/Compose lifecycle.
- Live: set `REDEVEN_OFFICIAL_TEMPLATE_TEST=1`, `REDEVEN_OFFICIAL_TEMPLATE_NATIVE=1`, `REDEVEN_OFFICIAL_TEMPLATE_EVIDENCE`; run `GOWORK=off go test ./internal/managedwebservice -run ^TestOfficialTemplateMarketLifecycle$ -timeout 60m -count=1 -v`. Requires Docker/frozen UI; cleans owned resources. Without native flag only prepares. Optional GITHUB_TOKEN remains request-scoped. `checkOfficialTemplatePage.mjs` captures reload/reopen; desktop requires actual pixels/decoded video, not empty canvas. Catalog v0.8.1/template revision 6 corrects Webtop images.
- November 9: older native/mock tests missed anonymous Desktop REST403/quota-zero; exact archive worked. Download success is not install/open proof. `desktop/scripts/check-template-source-acquisition.mjs` uses real sandboxed Electron preload/IPC/SDK without token/mock, saves four production snapshots and cleans up. Absolute evidence path becomes `REDEVEN_OFFICIAL_TEMPLATE_DESKTOP_SNAPSHOTS` input to independent Runtime byte/lifecycle verification, not unpinned API discovery.
- `desktop/scripts/check-template-deployment.mjs` needs owned bundle/evidence. `REDEVEN_TEMPLATE_DEPLOYMENT_KIND` selects DeepSeek Host/Container: real Welcome/Environment, anonymous acquire/form/deploy/open, onboarding, UI workspace creation, host mount/reload and uninstall. Pinned community image lacks xdg-user-dir: automatic initial workspace fails, manual works; no credentialed model qualification. Compose uses explicit pinned `REDEVEN_TEMPLATE_MARKET_IMAGE` in a separately authored template. Assert progress, one submit, running/open and cleanup under `scripts/desktop_test_session.mjs`.
- Earlier v0.8.2 official/native and container happy paths missed unavailable-source silent closure. UI tests `EnvPortForwardsPage`, `templateSourceAcquisition`, `serviceTemplateMarket`, `GitTemplateImport`, `ServiceTemplateCatalog`, `WebServicesPage` now cover automatic preparation, retry/prerequisites/expiry, token/isolation/pinned transfer, exact admission, search/facets and localized desktop/narrow geometry. Fixtures do not replace native qualification.
