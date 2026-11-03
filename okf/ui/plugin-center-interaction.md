---
type: UI Contract
title: Plugin Center interaction
tags: [ui, plugins, plugin-center, workbench, accessibility]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Redeven owns Plugin Center navigation; Floe owns dialogs, presence and input. Workbench uses a retained drawer and Activity the same directory page. Search/filter/selection/scroll persist. Closing management does not cancel Host execution; released ReDevPlugin owns lifecycle, permissions and surface authority.

# Contract

## Management placement and input
Only Plugin Center explicitly selects global Dialog placement at the product modal layer. Recent Dock or widget interactions cannot mount the drawer under `.workbench-surface`, `inert`, or a transformed canvas ancestor.

A successful Open closes management and focuses the target after canvas input becomes available; a failed Open preserves the directory and error feedback.

## Directory and responsive details
Local filters combine source (official catalog or external), trust, and lifecycle without rebuilding identity. Refresh status remains outside the card grid, so a pending refresh cannot appear as a duplicate card.

External installation source tabs retain three columns with the same complete accessible names when their visible selection labels need ellipsis.

## Shared design language

The directory, detail actions, package-install source form and update review compose released Floe controls. Cards use the shared default plane, without visible resting contours, decorative lift, icon magnification or custom shadow stacks. Selected cards use the shared selection fill. Shared Tags carry trust/lifecycle semantics without changing Host authority.

Floe owns Input focus, Button pending/disabled treatment and Tabs keyboard/selection behavior. Search, source/trust/lifecycle filters, retained selection and scroll remain product state. Menu triggers are single focusable boundaries with centered content, neutral hover and visible keyboard focus; nested trigger boxes are avoided. Details keep primary actions outside their scroll body, with secondary evidence in quiet disclosures.

Source tabs retain complete accessible names and three equal columns on compact dialogs. Mobile actions remain at least 44px; install progress replaces the primary action without changing card/sibling geometry. Reduced-motion, localized long copy and light/dark themes use the same shared controls.

## Restore saved data

Installed plugin details expose Restore saved data in the existing action menu. Discovery is read-only, including for enabled plugins. The user selects a retained record by date and instance suffix; Disable and continue is explicit when needed, and the Host then produces the exact review. A short confirmation states that current data is also retained. No permanent card, technical hash wall or automatic re-enable is added.

The dialog binds requests to the current session owner, target instance and read/write/admin permissions. Ordinary inventory refreshes preserve the review. Closing aborts reads; reopening the same target retains an uncertain plan and only checks status. Uncertain disabling likewise refreshes authoritative inventory without repeating the write. A completed recovery stays complete if list refresh fails. Source selection uses native keyboard-operable radio inputs; the existing Dialog owns isolation, dismissal and focus restoration, and mobile actions retain at least 44-pixel targets.

# Boundaries

Management presentation never creates a second lifecycle or permission authority. Global placement applies only to this product modal and its confirmations, not to ordinary Workbench widget dialogs or menus.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginManagement.browser.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterDrawer.tsx:1` - Source.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:1` - Source.

- redeven:internal/envapp/ui_src/src/ui/plugins/PluginRetainedDataDialog.browser.test.tsx:1 - Exercises single commits, uncertain outcomes, owner/target changes, permissions, focus, localized layouts and mobile geometry.
