---
type: Interaction Contract
title: Host application display and window layout
tags: [applications, ui, desktop, display]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Published Floe Native Apps owns Linux display configuration, constraints and cursor coordinates. Redeven declares layout/quality; Desktop owns actual maximize/minimize. Remote receipts cannot create resize loops, and unchanged configuration preserves canvases without commands. Old display backends retain logical density with explicit high-resolution limits; apps never auto-restart.

# Contract

- The native compositor owns Wayland/Xwayland geometry, resize and bounded family/popup capture. [Native stream](host-application-native-stream.md) owns picture regions/statistics and retained PNG compatibility.
- Xpra uses its selected HTML5 v20/v21 client; native chrome owns primary movement/maximize/minimize. Missing paint, close request or transport loss never proves closure.
- Clarity first requests SDK source density; encoding quality/HTTPS cannot recover absent detail. [Certificates](../security/local-ui-certificates.md) owns trust: viewer never creates/trusts certificates, changes saved protocol, restarts Runtime or downgrades TLS.

# Boundaries

[Viewer resources](host-application-viewer-resources.md) owns snapshot/upgrade admission. Unsupported input preserves viewing; incompatible loaded modules require save/quit/reopen. Native/Xpra use published cursor normalization; native stream owns bounds/hotspot/density/decode and macOS retains system cursor.

# Evidence

- `internal/codeapp/appserver/host_application_viewer/viewer.js`: SDK layout declarations, native state mapping and quality deduplication.

- `internal/envapp/ui_src/src/ui/services/hostApplicationViewer.test.ts`: declared geometry policies, late receipts, capability restrictions and repeated mode selection.

- `internal/envapp/ui_src/src/styles/hostApplicationDisplay.browser.test.tsx`: responsive density feedback, localization and keyboard dismissal.
