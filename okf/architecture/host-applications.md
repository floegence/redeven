---
type: Runtime Contract
title: Host application catalog and owned native sessions
description: Browse Linux and macOS host applications and open owned, reconnectable graphical sessions through existing authorized windows.
tags: [runtime, desktop, applications, security, ui]
timestamp: 2026-10-01T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns discovery, authorization and independent client sharing leases for host-user apps, without containers/VMs. Open admits/resumes sharing; last-viewer closure ends transport, not the process. Quit/confirmed force quit are explicit. Linux recovery is verified; macOS uses OS inventory. Missing capability/capture never proves exit.

# Contract

Catalog and session listing require read permission. Ownership comes from authorized session metadata, never a request-provided user ID.

Terminal sharing records remain bounded to forty-eight per Runtime lifetime.

Host Applications is available in Activity navigation and the Workbench launcher. A separate Force quit confirmation explicitly warns that unsaved work is lost; it never follows cancellation automatically.

Application inventory loading uses matching horizontal skeleton cards and respects reduced motion.

# Boundaries

The [macOS contract](macos-host-applications.md) owns native launch and capture; the [Linux lifecycle contract](linux-application-lifecycle.md) owns private display recovery.

Returned icons remain bounded PNG data URIs.

Audio, microphone, webcam, printing and remote notification forwarding remain excluded.

# Evidence

- `internal/hostapps/manager.go`, `linux.go` and `desktop.py`: discovery, instance recovery and sharing ownership.

- `internal/hostapps/manager_test.go` and `desktop_test.py`: lifecycle, installed-stack launch/resume/stop, managed/system icon decoding and theme priority, and literal argument preservation.

- `internal/codeapp/appserver/host_applications.go`, `host_application_viewer/`, and `host_applications_test.go`: API, permission/owner gates, and escaped private bootstrap.
