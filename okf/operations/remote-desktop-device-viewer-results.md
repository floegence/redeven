---
type: Qualification Record
title: Physical-device remote desktop Viewer qualification
tags: [desktop, input, deployment, latency, qualification]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Native 0.22.34 on udesk26 qualifies real Viewer picture/input, assisted Unicode, physical unlock, switching, fullscreen/disconnect and ten socket-loss recoveries. Median recovery 2015.7 ms/P95 2230.2 ms excludes photons. Real IME, matched cursor, command RTT, complete Orange acceptance and parity remain unqualified.

# Contract

October 11 actual Desktop Update and Env App-authorized deployment. Independent GTK receipts verify effects; wrong password stays locked. Initial shortcut lacks evidence, later switching passes. Task cleanup retains host services.

# Boundaries

Assisted textarea Unicode is not human composition. Initial black lock interval is unmeasured. Orange route/ARP/ICMP/banner proves connectivity only. Git retains original receipts/measurements.

# Evidence

- `desktop/src/main/remoteDesktopDeployment.ts` and its test: Env App-confirmed installation, Runtime binding and temporary credential scope.

- `internal/codeapp/appserver/remote_desktop_viewer/viewer.js`: production physical/text input, lock controls, reconnect, fullscreen and disconnect behavior.

- `internal/remotedesktop/attachment.go`: current-generation authority, independent native command IDs and unmodified result forwarding.
