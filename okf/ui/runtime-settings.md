---
type: UI Contract
title: Runtime settings
tags: [ui, runtime, settings]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Env owns destinations/drafts/adapters; Floe owns layout/navigation/modal presence/focus. Retain work surfaces and usable narrow controls. One global dialog retains the work surface and exact resource selection. Opening settings does not start a runtime, and resource Back actions preserve unsaved drafts.

# Contract

## Host and destinations
One global dialog sits beside definite-size retained work root/Flower portals, inert and accessibility-hidden through exit. Owners originate inside placement provider; moving DOM transfers no Solid context. Opening neither navigates nor starts Runtime. Desktop<=1060×760, narrow viewport-sized.

One header owns breadcrumb/mobile selector/close/generic refresh; domain refresh stays at resource. Search filters categories; roots omit Back; every resource target exposes a header Back action that clears only the resource, retains drafts and never starts or saves a runtime. Errors offer read-only Retry. Published slots/focus/Escape/dismissal apply to Welcome too. Retire mobile popup when wide breakpoint removes trigger; never measure detached header/add environment strip. Authority stays adapter-bound.

Env covers appearance/language, connection/status, terminal/browser, apps/desktop, containers/services, shell/workspace/Codespaces/tooling, permissions, Flower/extensions, plugin configuration, storage/Flower diagnostics, config/logging/debug. Center independently owns plugin catalog/install/update/remove; Settings only exact installed/author-preview configuration. Desktop groups model/defaults/extensions/browser/desktop under Flower, including search/mobile. Storage and runtime diagnostics are separate. Contextual gears share owners; Welcome setup is separate, access-gate language works before authorization.

settings/settings_resource URLs restore selection; unsupported identity shows unavailable, never substitution. Exact editors retain category drafts/unregister on domain close. Inventory needs no work surface. Closed sessions cannot revive via stale link; nested modal lifetime follows presentation/resource separately from draft/work.

## Authority and durable owners
Authority change cancels reads/fences replies; current admin/connection rights gate writes. Provider saves need no parent load and acknowledge once. Settings covers Flower read visibility through exit. Admitted installation retains Environment/incarnation across navigation; stopped/replaced Runtime rejects it.

Existing stores own appearance/language/themes/Markdown, terminal fonts/history, browser profiles/access/rate, host grants/picture, container CLI/proxy/helper/formats and Flower model/permission/directory/reasoning defaults. Shortcuts share owners; creation/session/navigation remains on work surfaces. Opening/category changes read only; Terminal settings never attaches/takes control. Font edits freshly read/CAS exact widget without moving session. Reconnect keeps drafts, invalidates confirmation. Container refresh cannot rebase edited revision; save requires explicit preflight. Exact operation lookup never permits replay; only authoritative pre-admission rejection unlocks, storage admission clears rejection marker.

Author previews bind exact workspace/preview with no installed grant/resume/replacement. Identity gates writes/portals. Viewers use authenticated preference/native opener; forwarded window cannot switch environment.

## Controls and stable interaction
Header/navigation/body share background. Published backdrop/X/Escape close without save/discard/underlying activation; nested closes top only and Flower stays expanded. Use32px controls/identity squares,12px text/quiet fill/field corners; Floe owns validation/keyboard/focus/menus. Scalar labels align without decorative icons; meaningful navigation/action/resource marks stay.

Category owns spacing/scroll. SettingsSection/List/Row forms have no extra inset/fixed viewport; hosted headings omit duplication but retain semantics/status/actions. Toolbars identify target; service/extensions use Tabs/reduced motion. Resolve JSX slots once. Compact SettingsRow language shares canonical owner. Published ThemePicker owns intrinsic/responsive choices/keyboard/theme; adapter owns persistence/admission. Leaving retires unadmitted appearance writes and reconciles admitted ones; no old popovers. Activity navigation and mobile tools open Settings; Env top bars have no settings/theme entry. Filled selection has no rails, including contrast. Model save feedback sits beside Models/host padding; stable feedback slots and truly empty headers disappear.

Narrow permission rows place identity/removal above complete checkbox labels. Edits/ceilings/deletion/resize retain surviving rows/focus; acknowledge captured revision only, newer edits dirty. Normalize without reordering, append sorted additions, retire removals, preserve focus when trimming. One identity/group, no generic introductions; retain permission/restart/zero/default/error consequences at decision, optional detail disclosed/full names accessible. Invalid container JSON stays editable with stable fields but disables preflight.

Host rows show identity/status/current action, removal in menu. Off needs feature-named confirmation and remains authoritative until success. Hide/authority loss retires intent; fresh action required on return. Current mutation owners gate grant/Wayland unattended/forget. Published SettingsDisclosure owns rounded groups/height-chevron motion/reduced motion/lazy mount/inert retained collapse/focus. Open state gates portals/permission/recovery; collapsing parent/recovery retires restart intent. Expansion grants/writes nothing. Granted state pairs success/check/text beside trailing action, readable in forced colors. Violet-window/blue-monitor SVGs distinguish app/desktop with themed instance-safe gradients.

Containers, Services and Plugin configuration use grouped lists with owner icons. Exact selectors and refresh occupy the retained category header, never repeat in lists, and retire with that category. Docker/Podman share audited theSVG brand assets with the work surface. Resource buttons have a zero minimum width so long workspace identities truncate without pushing out the fixed chevron. Duplicate service names expose workspace/instance identity; narrow headers wrap without squeezing names. Unsupported engines omit empty tabs and Save. Commit/discard require the selected source's dirty draft. Refresh preserves tabs and draft revisions and reconciles exact operations without replay. Service panels have one title; technical locks use disclosure. Idle footers are absent; dirty metadata/runtime retain save/review/apply. Plugin fields use published rows, selectors and checkboxes; Plugin Center stays independent.

Picture choice serializes complete authenticated-user record, preserving unrelated fields, no Save. Equal-width fields/stable feedback avoid movement. Failure halts queue with Retry; scope loss retires queued/late work, reopening/reads never replay. Narrow safe-area/keyboard/header bounds remain. SettingsSelect adapts lifetime/admission only; Floe renders/focuses/animates. Resource selector stays available; exact active identity gates writes. Leaving retires preflight even on immediate return; accepted work reconciles original authority.

## Browser Editor and configuration
One heading/status/refresh; embedded installer omits duplication. Selected route/primary action leads to real stages/progress/cancel/diagnostics; failure Retry/details. Ready version/source/update and selectable path/version/remove/copy disclosure retain install permission/confirmation. Show actual ports including disabled default; explain normalization ranges. Existing autosave/restart governs port/shell/filesystem/logging/permissions; PUT flat fields, not response wrappers. Runtime diagnostics retain permission and narrow geometry; obsolete full-backup browsing and restore are retired. [Extensions](flower-extensions.md) owns Skills/MCP.

# Boundaries

Read access never edits admin fields; shared controller explicitly confirms maintenance.

# Evidence

internal/config/config_update{,_test}.go/internal/settings_ui own contracts. EnvSettingsDialog/UnifiedSettings/AllCategories/Container/Plugin/ManagedService/HostAccess browser suites cover real resources/drafts/portals/history/authority/geometry/locales/accessibility. check-unified-settings-design.mjs qualifies actual Welcome themes/widths/locales/input/popup retirement/focus; check_unified_settings.mjs and check_unified_settings_acceptance.sh check ownership/behavior.
