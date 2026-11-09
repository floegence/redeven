---
type: UI Contract
title: Desktop Welcome navigation
tags: [desktop, welcome, flower, navigation]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Welcome navigation is local and immediate, independent of IPC/Runtime preparation. Each popup has one published Floe presence owner. Closing immediately revokes input/accessibility, freezes placement and retains DOM through exit.

# Contract

Header/logo/sidebar/context actions select locally. Health/progress cannot override selection; Main captures navigation after async reads to fence stale destinations. Environments/Redeven Cloud/Gateways render immediately. Hiding/disposal cancels motion without replay; [library](desktop-environment-library.md#library) owns cards. Environments/Flower mount on first use and persist; filesystem identity uses environment ID, Runtime start identity and session key, never probe times.

Gateway management is an in-shell detail page; All Gateways restores search/filter/scroll/focus. Global navigation retains its context; [Gateway interactions](../gateway/gateway-desktop-interactions.md) owns enrollment/recovery.

## Popup and dropdown ownership
Reopening reverses the same panel with drafts/selection. Transform only the inner surface; measure untransformed layout. Resolved collision direction/anchor owns origin; reduced motion uses immediate Floe presence.

- DesktopAnchoredOverlaySurface owns Environment split actions. DesktopActionPopover uses it for Runtime/Gateway progress/recovery, Cloud account/connections, SSH loading and directory help; DesktopPopover/DesktopTooltip use shared shorter tooltip presence.
- EndpointsPopover retains QR as internal disclosure; DesktopThemePicker shares surface ownership. DesktopAnchoredListbox owns language/container/official Cloud provider/SSH destination options.
- Published Dropdown owns saved Gateway/address pickers and object/connection actions. Select owns member/leave/Cloud-route/bootstrap and native form/listbox semantics.
- Flower adapters retain model/permission/reasoning/thread/child/Goal/composer/context presence. Published Select/Dropdown own settings/extensions/browser connections/tool capabilities/Kimi/frame rate; rate input stays outside dragging.
- File encoding/sheets use Select; find/info/cell panels retain shared presence. Compaction tooltip remains selectable. FlowerContextMenu retains presentation through exit.
- Published palette/feedback/dialog/drawer/directory components retain focus/presence. Contextual Ask Flower uses content-sized PromptCard for placement/input/focus/motion.

Action popovers use observeDialogHeight: one outer material/height owner, inner content clip without fill/border/shadow. Top placement anchors bottom/trigger gap without text scaling. Observe beneath the height owner to avoid feedback; close freezes painted height, reduced motion commits natural size.

Environment split actions retain primary button/anchor through admission/progress/recovery/completion. StableText covers localized transient labels; published slow color tokens ease inverse ink/fill together. Tooltip changes never remount controls or change authority.

Do not wrap these components in open-only Show blocks. Observations cannot reopen dismissed surfaces or release a newer session. Existing owners retain selection/confirmation. PromptCard receives product content/admission and Desktop's model directory/attachment transport; Floe owns appearance/input/file/model/motion. Request-local model selection never changes global defaults; uncertain retry retains captured model/staged files.

# Boundaries

Navigation grants no Runtime authority. [Ask Flower](../ui/flower-activity-companion.md#contextual-window) owns contextual placement.

# Evidence

App.tsx owns navigation. check-welcome-popup-motion.mjs samples directions, bounds, stable layers, entrance/exit/reversal and reduced motion at desktop/narrow light/dark. DesktopOverlayMotion.client.test.tsx covers input revocation/draft retention/completion. check-office-preview.mjs covers real Electron file-protocol selection, nested dismissal, responsive controls and retained document identity.
