---
type: UI Contract
title: Runtime settings
tags: [ui, runtime, settings]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Env App owns destinations, drafts and adapters; Floe owns layout, navigation, retained modal presence and focus. Preserve work surfaces and usable narrow layouts.

# Contract

## Host and destinations
One global Settings dialog sits beside a definite-size, retained work-surface root including Flower portals. That root remains inert and accessibility-hidden through exit. Create owners within the global placement provider; moving DOM does not transfer Solid context. Opening settings neither navigates nor starts Runtime. Desktop caps at 1060x760; narrow layouts use the viewport.

One header owns breadcrumb/mobile selector, close and generic refresh; domain refresh stays with its resource. Search filters categories; category roots omit Back, nested destinations may return. Errors expose inline read-only Retry. Floe owns header slots, focus return, nested Escape and dismissal. Welcome shares backdrop/category-header behavior; retire mobile popups when their rendered trigger disappears at wide breakpoints, never measure retained off-document headers or add a separate environment strip. Exact runtime authority remains adapter-bound.

Env categories cover appearance/language, connections/status, terminal/browser, host apps/desktop, containers/services, shell/workspace, Codespaces/tooling, permissions, Flower/extensions, plugin configuration, storage/recovery, config/logging/debug. Plugin Center independently owns catalog/install/update/remove; Settings hosts exact installed-instance or author-preview configuration. Desktop groups model/default settings, extensions and browser/desktop capabilities under one Flower category, including search/mobile navigation. Storage overview and Flower recovery stay separate destinations. Contextual gears use these owners; Welcome setup remains separate and access-gate language works before authorization.

URLs use settings/settings_resource; history restores selection. Unsupported identities show unavailable, never substitute targets. Editors register exact owners, retain drafts across categories and unregister on domain close. Inventory needs no mounted work surface. Closed sessions cannot be revived by stale links; nested dialogs follow presence/category/resource independently of draft or operation lifetime.

## Authority and durable owners
Authority changes cancel reads and fence replies; current admin/connection rights gate writes. Independent provider saves need not await parent loading and acknowledge once. Settings covers Flower read visibility until exit. Admitted installations retain captured environment/incarnation through navigation; stopped/replaced Runtimes reject them.

Existing stores remain authoritative: appearance/language/themes/Markdown scale; terminal defaults/widget fonts/history; browser profiles/site access/frame rate; host grants/picture preferences; container engines/CLI/proxies/helpers/formats; Flower providers/models/permissions and personal model/directory/reasoning defaults. Direct shortcuts and Settings use the same owners; creation/session/navigation stays on work surfaces.

Opening/category changes read only. Terminal settings never attach or take control. Widget font edits read fresh state and CAS exact widgets without moving sessions. Reconnect retains drafts but invalidates confirmations. Container refresh cannot rebase edited revisions; save requires explicit preflight. Recover exact operation IDs; failed/missing lookups never authorize replay. Only authoritative pre-admission rejection unlocks a request; storage admission clears rejection markers.

Author previews bind exact draft workspace/preview, with no installed authority or implicit resume/replacement. Current identity gates writes and portals. Application viewers use authenticated preferences and their registered native opener; forwarded windows cannot change environments.

## Controls and stable interaction
Header/navigation/body share one semantic background. Published backdrop, X and Escape share close behavior without saving, discarding or activating the underlying page; nested dismissal affects only the top modal. Retained Flower stays expanded. Use released 32px controls, 12px text, quiet fills, subdued borders and field corners; identity icons use 32px squares. Floe owns validation/keyboard/focus/menu behavior. Scalar labels share a leading edge without decorative icons; navigation/actions/resource cards retain meaningful marks.

Category owns spacing and scrolling. Embedded forms use SettingsSection/List/Row without extra insets or fixed viewports. Public hosted variants remove repeated headings while preserving semantic names, status and actions. Resource toolbars identify exact targets; service/extension navigation uses Floe Tabs and reduced-motion behavior. Resolve retained JSX header slots once to avoid duplicate popup owners. Both hosts use the compact SettingsRow language selector. Published ThemePicker owns intrinsic mode choices, responsive cards, keyboard and styling; adapters own persistence/admission. Retire unadmitted appearance writes on leaving, reconcile admitted writes, and never restore old popovers or top-bar theme toggles. Filled selection has no left rails, including high contrast. Embedded Flower save feedback belongs beside Models, with host padding. Language uses the canonical selector; feedback slots remain stable, truly empty headings disappear.

Narrow permission rows stack identity/removal above full checkbox labels. Editing/ceiling/deletion/resize preserves surviving row identity. Save acknowledges only captured revision; newer edits stay dirty. Normalize subjects without reordering survivors, append sorted authoritative additions, retire only removals and preserve focus while trimming.

Show one identity per group, omitting generic/repeated introductions. Keep permission, restart, zero/default and error consequences at the decision; disclose optional detail. Full truncated names remain accessible. Container parsing retains field identity; invalid JSON remains editable and disables preflight, without changing authority/recovery semantics.

Host access rows show identity/status and current action; removal is in the menu. Feature-named confirmation is required for Off, which stays authoritative until success. Hiding/authority loss retires destructive intent; reopening requires explicit action. Mutation owners gate grants, Wayland unattended and forget operations. Published SettingsDisclosure owns shared rounded groups, reversible height/chevron motion, reduced motion, lazy mount, retained inert collapse and focus return. Product open state gates portals and permission/recovery admission; collapsing recovery or its parent retires restart intent. Expansion never requests grants or writes preferences. Granted system permissions pair readable success text/check with the trailing action, including forced colors. Product violet-window/blue-monitor SVGs distinguish application/desktop access with theme-aware, instance-scoped gradients.

Picture choices enqueue the complete authenticated-user record, preserving unrelated platform fields, with no Save. Equal-width fields and one stable feedback slot avoid movement. Failure stops the queue and retains explicit Retry; identity loss retires queued/late work. Reads/reopening never replay edits. Narrow geometry honors safe areas, keyboard and header bounds.

Containers, Services and Plugin configuration use grouped lists with owner icons. Exact selectors and refresh occupy the retained category header, never repeat in lists, and retire with that category. Duplicate service names expose workspace/instance identity; narrow headers wrap without squeezing names. Unsupported engines omit empty tabs and Save. Commit/discard require the selected source's dirty draft. Refresh preserves tabs and draft revisions and reconciles exact operations without replay. Service panels have one title; technical locks use disclosure. Idle footers are absent; dirty metadata/runtime retain save/review/apply. Plugin fields use published rows, selectors and checkboxes; Plugin Center stays independent.

SettingsSelect only adapts product lifetime/admission; Floe renders and owns focus/motion. Resource selection remains available, but writes require exact active identity. Leaving retires preflight even on quick return; admitted work reconciles under original authority.

## Browser Editor and configuration
One heading/status/inventory refresh; embedded installer removes duplication. Setup shows selected route and one primary action, then real stages/progress/cancel/diagnostics. Failure retains Retry/details. Ready state shows compact version/source/update; installed paths/versions use accessible disclosures with selection/remove/copy. Existing permission/install confirmation remains.

Show actual ports, including disabled defaults; explain ranges when normalization changes custom input. Existing autosave/restart governs ports/shell/filesystem/logging/permissions. PUT uses flat fields, not response wrappers. Health/diagnostics/backup/restore retain authorization and confirmation. Actions/progress fit narrow layouts. [Extensions](flower-extensions.md) owns Skills/MCP.

# Boundaries

Read access never edits admin fields. Runtime maintenance requires its shared controller's explicit confirmation.

# Evidence

Owners: internal/config/config_update{,_test}.go and internal/settings_ui/src. EnvSettingsDialog, UnifiedSettings, EnvSettingsAllCategories, ContainerSettingsPanel, PluginSettingsPanel, ManagedServiceSettingsDesign and HostAccess browser suites cover populated targets, drafts, portals, history, authority, geometry/locales/accessibility. desktop/scripts/check-unified-settings-design.mjs qualifies actual Welcome owners across locales, widths and themes with retained inputs, popup retirement and focus. scripts/check_unified_settings.mjs checks ownership; scripts/check_unified_settings_acceptance.sh qualifies behavior.
