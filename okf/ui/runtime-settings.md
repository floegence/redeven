---
type: UI Contract
title: Runtime settings
tags: [ui, runtime, settings]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Env App owns settings destinations/drafts/API adapters; Floe reusable layout/navigation. Narrow/revisited panels retain usability, drafts and scroll. A ready editor has a compact version/source row with the update action. Installed versions and installation paths use keyboard-accessible disclosures; selection, removal confirmation and copying stay available.

# Contract

## Unified settings host
Env App and Desktop open one global Settings dialog above the current work surface. Activity, Workbench, terminal sessions, plugin surfaces, Flower drafts and scroll retain their owners; opening settings is not work navigation. The Env work-surface root, including retained Flower portals, stays laid out but inert and accessibility-hidden until Settings presence exits; the dialog is its global sibling. Published Floe owns retained DOM, modal placement, focus, nested Escape and inert exit. Create the stable retained owner inside the global placement provider: moving DOM cannot transfer Solid context to nested dialogs. Its root owns definite dimensions. Desktop caps the host at 1060 by 760 pixels; narrow screens use the viewport. Search filters navigation; mobile uses the same category targets. Desktop environment selection names the exact target; opening never starts a Runtime.

Env App has one dialog header: the category breadcrumb or narrow category selector shares a row with close. Generic settings categories show their own refresh there; injected domain categories keep refresh beside the resource it actually reads. A generic settings read failure always exposes an inline read-only retry, including inside domain categories. Category roots have no Back action that merely closes the host. Real nested browser/extension subpages may return to their parent. The page projects its retained header through the published Floe header slot; navigation and refresh keep one controller. Floe retains the dialog's accessible title and owns focus return and modal behavior.

Env categories cover Appearance & Language, Connection, Runtime Status, Terminal, Browser, Host Applications & Desktop, Containers, Services, Shell & Workspace, Codespaces & Tooling, Permission Policy, Flower, Extensions, Plugin configuration, Storage, Flower recovery, Config File, Logging and Debug Console. Plugin Center remains an independent retained feature reached through its existing switcher entry; absence of an Activity bar item does not make it a settings category. Catalog, installation, updates and removal belong to that center. Settings hosts only installed-plugin and author-preview connection configuration, pinned to exact resource identities. Desktop offers appearance and environment connection settings, plus one Flower group containing model/default settings, extensions and browser/desktop capabilities. Search and mobile navigation retain that grouping. Header/mobile commands and contextual gears route to their applicable owners. Welcome Cloud/Gateway/environment connection configuration is outside this Env App consolidation. Access-gate language remains available before authorization.

Env links use `settings` and optional `settings_resource`; Back/Forward restores selection. Unknown/unsupported resources show an unavailable state, never another service, thread or environment. Contextual browser/service/connection editors register their exact owner, keep drafts across category changes, and unregister on domain close. Terminal, container and author-preview settings discover their own exact resource inventory independently of a mounted work surface. Closing the host closes its contextual session; stale links cannot revive it. Generic forms retain their scope-owned drafts. All nested dialogs follow exact host presence/category/resource support, separately from draft and operation ownership.

Host authority changes abort settings reads and reject late replies. Current admin/connection rights gate mutations; cached permission observations are insufficient. Independent provider saves do not depend on unrelated parent loading and publish success once. Settings covers Flower read visibility until modal exit. Installation transfers already admitted to an environment remain owned by that environment, not its visible settings panel or the current default model owner. Renderer grants and native explicit lookup bind the captured running incarnation; changing the selection cannot cancel or retarget admitted bytes, and a stopped/replacement Runtime rejects them.

## Durable configuration inventory

| Destination | Canonical configuration |
| --- | --- |
| Appearance & Language | Language, shell theme, Workbench canvas theme, Markdown text scale |
| Terminal | Client font defaults, exact Workbench widget fonts, session/default history retention |
| Browser | Browser profiles, site access, Flower computer-viewer frame rate |
| Host Applications & Desktop | Host helper access, Wayland authorization, authenticated-user application picture preferences |
| Containers | Exact engine and Docker CLI configuration, proxies, credential-helper references and output formats |
| Flower | Runtime providers/model profile, permission defaults, personal new-conversation model/directory/per-model reasoning |
| Plugin configuration | Exact installed-instance and author-preview connection settings; management stays in Plugin Center |
| Remaining sections | Managed services, shell/workspace roots, tooling, policy, extensions, storage/recovery, config export, logging and diagnostics |

Welcome Cloud/Gateway/environment connection configuration is a separate scope. Session actions, resource creation and navigation state stay on their work surfaces. Markdown zoom, Workbench HUD theme, Flower frame rate and composer model/directory/reasoning remain direct shortcuts to the same canonical preference owner; no separate persistent store is permitted. Global settings exposes each even before its work surface mounts.

Opening or changing a category performs reads only. Terminal settings never attach or take control; the published controller events own current authority. Workbench updates read a fresh snapshot and CAS the exact widget without changing session placement. Reconnect invalidates confirmations but retains drafts. Container drafts retain each source's original revision; refresh cannot pair edited bytes with a newer revision. Saves require explicit preflight review. Recovery uses exact operation ID, or exact request ID if admission response was lost. A missing lookup does not prove rejection or permit replay. Only the server's pre-admission rejection marker unlocks a definitively rejected request; entering storage removes that marker.

Author previews use the existing draft catalog and exact workspace/preview identity, never an installed instance, automatic workspace resume or implicit preview replacement. Category changes retain drafts; live permission and identity checks gate writes and portals. Application viewers only read authenticated picture preferences and link back through their registered exact opener/native window. Arbitrary forwarded windows cannot open settings in another environment.

## Codespaces and Browser Editor
The breadcrumb owns the visible destination label. The content has one Browser Editor heading, one status badge and one inventory refresh action. The settings installation surface omits its standalone heading and refresh control; initial setup shows the selected installation route and one primary action without an idle progress checklist or empty current-editor rows. Active setup shows the current stage once, measured progress, cancellation and diagnostics; errors retain explicit retry and failure details. Runtime permissions and install/update confirmations remain authoritative.

Port fields show their values directly, including disabled defaults. The effective range is explained only when normalization changes custom input; autosave and its flat API payload remain unchanged. Floe tokens set field heights, corners and text; setup actions wrap and progress adapts within narrow settings surfaces.

## Settings controls and identity
The Env dialog header, category navigation and content share one semantic background in light and dark themes; contrast belongs to fields, selection and dividers, not separate large panels. Backdrop clicks close Env Settings through the published Floe modal stack, using the same session-close path as X/Escape. Closing does not save, activate the underlying page, or discard scope-owned drafts. Settings controls and backdrop are owned Flower interactions: they cannot collapse the retained companion underneath. Nested backdrops dismiss only their topmost modal. Welcome uses the same backdrop dismissal and category-header layout. Its mobile category popup retires when the rendered trigger disappears at a wider breakpoint; retained off-document headers are never measured. It has no separate environment-name strip; exact runtime authority remains adapter-bound.

Runtime, Desktop environment, Flower, terminal and managed-service fields share the published Floe control height (32px, `--floe-control-height-md`), `--floe-radius-field` corners, 12px text, quiet fill and subdued 1px border. Row identity icons and provider brands occupy the same 32px square on `--floe-radius-md`, so icon, field and select edges stay concentric within a row. Floe owns keyboard, validation, menus and border-only focus. Ordinary settings rows never render decorative label icons: every scalar label shares one leading edge. Navigation, action controls and resource cards retain their meaningful icons.

Each category owns spacing and scrolling. Embedded forms use natural flow, not another drawer viewport. Published Floe SettingsSection/List/Row own hierarchy; hosted page headings are omitted through the public visibility API. The dialog header alone names the category. Resolve JSX slots once to avoid duplicate popup owners. Sections without metadata/actions/feedback omit their header; Flower feedback sits beside Models.

Containers, Services and Plugin configuration use grouped lists with owner icons. Exact selectors and refresh occupy the retained dialog header and retire with their category; lists show no selector or repeated title. Duplicate service names expose workspace/instance identity. Narrow headers wrap without squeezing names. Unsupported engines have no empty tabs or Save; commit/discard controls require the selected source's dirty draft. Refresh retains available tabs and draft revisions, reconciling exact operations without replaying writes. Service tabs name panels once; technical locks use disclosure. Idle service footers are absent; dirty metadata and runtime retain explicit save/review/apply. Plugin fields use published rows, selectors and checkboxes; Plugin Center stays independent.

Published Floe Tabs, ThemePicker and modal controls own navigation, focus and motion, including reduced motion. Language uses one preference owner and a compact row selector in both hosts. Appearance & Language includes shell theme, Workbench theme and Markdown scale; Env top bars have no theme toggle. Selected rows never have left rails, including high contrast. Deferred appearance writes belong to their presentation lifetime; navigation retires unadmitted writes while accepted writes reconcile. Do not restore product theme popovers.
Narrow permission rules keep the same mounted identity input and permission controls in a stacked layout: identity/removal first, then complete localized permission names beside their checkboxes. Never compress the matrix into character-wrapped column headings or clone the editor for mobile. Editing, ceiling changes, deletion and responsive reflow preserve each surviving rule’s input identity. A save acknowledges only its captured edit revision; newer edits remain dirty until their own save settles. Acknowledgments match normalized subjects to existing rows without sorting surviving editors; trimming a subject retains the focused input. Authoritative additions append in sorted order and removals retire only their absent subjects.

Prefer one visible identity per control or group. Values, previews and direct actions explain ordinary choices; omit repeated titles, generic page introductions and prose that restates labels. Keep essential scope, restart requirements, zero/default semantics, permission consequences and errors visible at the relevant decision. Conditional guidance follows the selected option. Optional technical details belong in existing disclosures. Preserve complete accessible names and full destination tooltips when long navigation labels truncate.

Structured container editors keep stable field identities while typing. Parsing a new document must not remount the form or replace proxy/helper rows. The raw JSON editor remains available through temporarily invalid drafts so the user can repair them; invalid JSON never enables preflight. These presentation rules do not alter revisions, authority or operation recovery.

Host application and desktop access use the same published SettingsList/SettingRow surfaces, spacing and typography as picture preferences. Identity and status sit at left, the current switch or setup action at right, and low-frequency removal in the menu. Switching off requests an explicit feature-named confirmation; the switch stays authoritative until success. Confirmations and menus follow category presence and live authority; hiding or permission loss retires destructive confirmation intent, so returning requires a fresh explicit action. Retained host controls and their mutation owners check current presentation, including system permissions and Wayland unattended/forget-consent actions. Picture fields have equal desktop widths and full-width narrow controls. Saving and error recovery occupy one stable inline feedback slot; they never insert a footer or move the following access switches. Each explicit picture choice saves immediately without a Save button; writes serialize the complete authenticated-user record and retain untouched platform fields. A failed write stops the queue and preserves choices for explicit Retry. Permission/identity loss retires queued admission and late responses; reads, navigation, reopening and authority recovery never replay retained choices. Narrow Env Settings uses the published zero-gap variables while retaining Floe's safe-area, keyboard and shell-header bounds.

Host access disclosures use published Floe SettingsDisclosure for picture tuning, system permissions, recovery, empty-state guidance, desktop options and authorization details. The same rounded SettingsList boundary, SettingRow fields and chevron identify each group. Floe owns reversible height/chevron motion, reduced motion, lazy first mount, retained content, inert collapse and focus return. Product open state also gates portalled picture controls and permission/recovery admission; collapsing recovery or its parent retires unconfirmed restart intent. Expanding never starts a permission request or writes preferences.
System permission state sits beside its trailing action; granted access uses the success color and a check, with readable text in forced colors. Product-owned violet window and blue monitor SVGs distinguish application access from whole-desktop access; their palette adapts to light/dark surfaces and instance-scoped gradients remain safe in retained views.

Retained settings selectors use the thin product SettingsSelect adapter. Category/resource presentation owns popup visibility and callback admission; published Floe owns rendering, keyboard, focus and motion. Resource selectors stay available across resources, while editor writes require the exact active resource. Leaving a resource retires pending preflight intent even if the user returns before it resolves; already accepted operations still reconcile under their original authority.

## Configuration editing
Existing autosave/restart rules govern shell, filesystem, logging, ports and permissions. Settings PUT accepts flat fields, never response-group wrappers such as `runtime`/`logging`/`codespaces`. Health, diagnostics, backup/restore use right-column actions without bypassing permission/confirmation.

## Flower extension placement
[Flower extensions](flower-extensions.md) own Skills/MCP browsing and management.

# Boundaries

Read access cannot edit administrator fields. Runtime maintenance requires explicit user confirmation through its existing shared controller.

# Evidence

- `redeven:internal/config/config_update.go` and   `redeven:internal/config/config_update_test.go` own coordinated configuration   transactions, settings preservation, account removal, and failed writes.

- `redeven:internal/agent/gateway_membership_lifecycle_test.go`,   `redeven:internal/agent/control_artifact_source_test.go`, and   `redeven:internal/agent/cloud_link_test.go`

- `internal/settings_ui/src`: product navigation and retained host adapters.
- `EnvSettingsDialog.browser.test.tsx`, `UnifiedSettings.browser.test.tsx`: real-host targets, drafts, portals, history, backdrop dismissal, nested Escape, read recovery and live authority.
- `EnvSettingsAllCategories.browser.test.tsx`: actual populated category owners at five widths, representative locales, themes, touch, reduced motion and continuous dialog surface; no substituted empty panels.
- `ContainerSettingsPanel.browser.test.tsx`, `PluginSettingsPanel.browser.test.tsx`, `ManagedServiceSettingsDesign.browser.test.tsx`: field identity, exact resources, retained drafts and scoped editors.
- `HostAccess.browser.test.tsx`: real-host application/desktop access controls, scoped nested setup, focus return, explicit helper recovery, localization, narrow layouts and accessibility.
- `desktop/scripts/check-unified-settings-design.mjs`: real Welcome category owners across three locales, three widths and both themes, with retained inputs, popup retirement, modal dismissal and focus return.
- `scripts/check_unified_settings.mjs`: bounded source ownership gate; `scripts/check_unified_settings_acceptance.sh`: explicit behavioral qualification.
