---
type: Interaction Contract
title: Host application viewing, display and resource lifetime
tags: [applications, ui, desktop, runtime]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

Runtime/native events own application facts; bootstrap and published SDK own viewing, geometry and immutable resources. Decode current pixels before input and preserve process identity through reconnect. Transport loss never proves exit; incompatible loaded protocols require explicit save/quit/reopen.

# Contract

## Viewer state
Use [Flowersec window transport](graphical-window-transport.md) for graphical state/picture/input. Reserve browser tab in initiating click, retain app identity through admission and use host launch deduplication for retry; closing pending tab cannot kill uncertain admission. Browser loading has no Desktop chrome/Node dependency. Pre-window launcher exit fails; a live slow process has no window timeout. Terminal records are bounded memory, lost on Runtime restart; expired routes reopen from library. Only confirmed final-window/app closure dismisses established viewing; empty inventory/transport loss proves no exit.

## Display and native streams
Published compositor owns Wayland/Xwayland geometry,resize and bounded family/popups; Xpra uses selected v20/v21 client. Native chrome moves/maximizes/minimizes primary window. Missing paint/close request/transport proves no closure. Request source density for Clarity; quality/HTTPS cannot recover absent detail. [Certificates](../security/local-ui-network-exposure.md#certificates) owns trust: viewer never creates/trusts certs,changes protocol,restarts Runtime or downgrades TLS.

Modes Automatic/Clarity first/Motion first/Save data persist through reload; same selection,locale/theme never reconnect. [Performance](../operations/host-application-performance.md) owns budgets. Published native library owns capture/regions/encoding/composition/cursor normalization. Retain complete cursor PNG/alpha/bounds/hotspot: longest<=24CSSpx,never enlarge small images. New shares use current resources without changing app identity; macOS keeps client system cursor. Only composed current pixels authorize input/ACK.

## Resources and compatibility
Floe owns immutable documents/assets/digests/capabilities; pin one per authorized Xpra share. New combined Linux sessions use native canvas/frame/input/cursor. Xpra pre-client inherits viewer's Flowersec constructor and fails without it. Retiring share revokes its snapshot lookup only.

Compatible viewers reconnect; missing/corrupt/unsupported resources fail preparation/Retry. Protocol<2 retains logical density with explanation. Unsupported input/pointer disables controls while preserving pictures/local UI; authenticated incompatible loaded modules need save/quit/reopen, never hot swap. Transient focus/context follows normal recovery. Quality changes use current authenticated attachment and cannot choose codec/binary/capture executable/install. Native component/decoder must share published SDK; no product codec/parser.

# Boundaries

App minimums,reserved OS shortcuts,inaccessible windows and browser dismissal limits remain authoritative. Digests cover real names/bytes,adapters/transformed worker URLs. Resource origins must name active authorized share,never CodeSpace/unrelated/expired/unknown origins; no old application-HTTP-tree fallback. [Application authority](host-applications.md) owns admission/termination and [input](host-application-input.md) owns delivery. Geometry/resource notices grant no exit or first-pixel evidence.

# Evidence

- `internal/codeapp/appserver/host_application_viewer/`: connection reconciliation, first-frame, terminal and geometry adapters.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts` and `macHostApplicationViewer.test.ts`: backend events, stale callbacks, first-pixel, pointer gestures and reconnect acceptance.
- `internal/codeapp/appserver/host_applications_test.go`: complete localized launch requests, owner-authorized terminal snapshots and retained state routes.

## Display
- `internal/codeapp/appserver/host_application_viewer/viewer.js`: SDK layout declarations, native state mapping and quality deduplication.
- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts`: declared geometry policies, late receipts, capability restrictions and repeated mode selection.
- `internal/envapp/ui_src/src/styles/hostApplicationDisplay.browser.test.tsx`: responsive density feedback, localization and keyboard dismissal.

## Native streams
- `internal/codeapp/appserver/host_application_viewer/linux.js`: preferences, negotiation, painted-target binding and statistics.
- `internal/hostapps/desktop_transport.go`: authenticated capability forwarding and attachment ownership.
- `internal/codeapp/appserver/host_applications.go`: published decoder resource integration.

## Resources
- `internal/hostapps/linux.go`, `setup.go`, `manager.go`: current share preparation, component-bound recovery and snapshot lifetime.
- `internal/hostapps/application_proxy.go` and `client_assets_test.go`: matching documents, obsolete path rejection, immutable bytes and per-share revocation.
- `internal/codeapp/appserver/host_applications.go` and `host_application_assets_test.go`: permission, origin, owner, digest and cache authorization.
