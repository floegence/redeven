---
type: Validation Guide
title: Linux desktop and package compatibility validation
description: Assess released native backend evidence separately from Redeven viewer, package, recovery and deployment acceptance.
tags: [operations, host-applications, validation, linux, packages]
timestamp: 2026-09-29T00:00:00Z
---
# Summary

The [platform contract](../architecture/host-application-platforms.md) is qualified
by real processes, windows, native input receipts and saved files. Floe Native Apps
owns reusable graphics/package/service evidence; Redeven owns product launch,
sharing, rendering and recovery evidence. Each claim retains its source/component
identity. Prototype results do not substitute for exact-release qualification.
Missing capabilities remain explicit failures, and no result certifies arbitrary
applications, physical GPUs or every desktop version.

# Contract

## Release identity and evidence layers

Redeven consumes published `github.com/floegence/floe-native-apps` v0.21.0 at
`a7f3b76a2a9dd64ba13b303c24d7bed645b33441`, with module checksum
`h1:E1Wgl8aRB/h53ejCCDkUwlrj3uC2zx+SGcAODZZ5nWg=`. Go proxy, checksum database
and release ZIP readback match. Formal tests set `GOWORK=off` and use that module.
The upstream task branch/worktree is removed before product integration.

| Architecture | Combined component digest |
| --- | --- |
| amd64 | `f8f29cf383166c4e7c6728b6c1f696ab015391875dc2a370f283d4d4ca457a90` |
| arm64 | `93a0210e630a54d176f9b8f6ff3fc21605a348d6f97c7c5c8127fa6cd7a484be` |

The immutable tag Release gate passed, alongside main source checks and security
analysis. The tag qualification covers native installation, integrity, cancellation/recovery, source/race/vet,
managed/system Xpra, toolkit ABI baselines and application input/save receipts.
The retained upstream qualification archive records broader desktop/package
experiments at their original source hashes; these are not relabelled as fresh
product runs. The module's qualification corpus remains the authority for exact
fixture versions and security boundaries.

## Package, desktop and graphics coverage

| Case | Evidence and scope |
| --- | --- |
| Strict Snap Firefox | Real user-systemd scope, private graphics/bus, native confirmed text and saved document in upstream qualification; Redeven browser adds click-to-type, repeat, field selection, copy/paste and toolbar receipts |
| Flatpak GTK/Qt | GNOME Text Editor and KWrite use real sandboxes, package metadata, remote official file dialogs and document grants upstream; Redeven verifies native first frame, repeated Unicode, selection replacement, text/Enter order and actual Ctrl+S bytes |
| Native DEB/RPM | Native GTK/Qt/browser and GNOME Text Editor receipts; retained Fedora 44 RPM Firefox 156.0.1 and Text Editor 50.1 evidence keeps SELinux Enforcing and original signed packages |
| AppImage/classic Snap | Retained original mounted Notepad Next v0.15 and classic Snap Emacs 31.1 input/save/reconnect/exit evidence; Redeven additionally verifies mounted AppImage click-to-type, Unicode, replacement and exact Ctrl+S bytes; no extraction or sandbox bypass |
| Desktop coexistence | Actual GNOME Xorg/Wayland, KDE Wayland and Xfce X11 shells in disposable native KVM qualification, with unrelated applications retained; these virtual-display tests do not certify physical GPUs |
| No full desktop | Native application preparation and private software rendering without a monitor or complete desktop; sandbox package requirements remain separate |
| Wayland/Xwayland | Pure GTK/Qt/Chromium Wayland and mixed native window families, menus, oversized dialogs, generation-bound input and reconnect; retained Xpra remains an explicit distinct backend |

Disposable Ubuntu 24.04 native amd64 testing runs inside the task guest on udesk26.
Native arm64 testing runs in the task-owned Lima guest. These virtual machines are
test isolation, not production requirements. No udesk24 testing is performed for
this delivery. User runtimes and applications on udesk26/orange are not replaced.
Test documents, profiles, displays and service endpoints are task-owned. Neither
AppArmor/SELinux nor browser sandboxing is disabled.

## Product acceptance

The v0.21.0 integration repeats production-viewer native input on Chromium,
Firefox and WebKit and actual Chrome/Firefox stream acceptance on udesk26.
The [performance guide](host-application-performance.md) owns picture modes,
bandwidth, latency, bounded decode work and explicit claim limits. New browser
launches use product-owned profiles while existing personal desktop browsers stay
untouched. Fresh source tests cover launch diagnostics and retained legacy streams.
The broader product/package receipts below are retained v0.20.0 integration
evidence; the tag's upstream matrix supplies fresh native component qualification.


Chromium, Firefox and WebKit run the production viewer and authenticated native
transport against a real GTK application. The locked Electron 41.10.5 runtime
runs the same fixture in an actual BrowserWindow. Receipts establish physical-key
delivery, simulated confirmed Unicode, repeat/release, copy/paste, separate fields
and local toolbar isolation. Browser clipboard normalization is recorded explicitly.

Actual pointer receipts cover tap/double/right click, long-press drag, diagonal
nested scrolling, hardware wheel after touch, final-frame delivery and stopping
on release. Browser touch injection remains synthetic. Native macOS regression
uses its existing helper and disposable application; the shared canvas does not
change native permissions, lifecycle or input-source selection.

Product lifecycle fixtures prove native input/save and Runtime recreation keep the
same helper; invalid clipboard publication cancels dependent input without replay.
Retained Xpra survives component update, verified v1/v2 record migration and
Runtime restart. A fresh instance selects the combined backend. Orderly and abrupt
Runtime exits retain double-forked applications. The old 40-second startup boundary
cannot terminate an unconfirmed live process. Package launch failures preserve
phase/code/exit status and remain recoverable in the page.
Real GTK final-window destruction closes Chromium, Firefox and WebKit popup
viewers while the same windowless native process survives. Minimized windows,
unavailable capture, first-frame waiting and reconnect snapshots remain open.
Explicit retained-Xpra termination keeps its normal end reason; an unexplained
backend death stays a failure.

The affected checks include hostapps and appserver race tests, CLI component
transfer, vet, viewer/localization tests, Chromium/Firefox/WebKit surfaces,
Desktop host-application tests, Swift host-application tests, dependency boundaries,
generated viewer assets, attribution and OKF integrity. Test harnesses consume
current session state rather than fabricating perpetual `running` status.

# Boundaries

## Interpretation and remaining limits

The earliest Qt product fixture incorrectly supplied KWrite's unsupported `--new`
argument. Its launcher exit 1 is retained as failure evidence; the valid official
command passes. GTK and Qt editors have distinct trailing-newline serialization
policies, declared explicitly by fixtures before checking saved bytes. Input text
is not changed to satisfy those application policies.

The first macOS pointer run observed extra nonprecise native wheel events absent
from remote packets and failed its drag assertion; the unchanged-source isolated
rerun passed. Both receipts are retained rather than claiming a production fix.
The first WebKit closure probe installed its recording hook twice; an idempotent
hook records one actual close call and one page-close event on the passing run.

Exact Unicode bytes do not prove installed font coverage. Minimal guests without
CJK/emoji fonts can display missing-glyph boxes while receiving correct text.
Real system IME candidates and physical mobile devices remain independent unpassed
acceptance items. Browser dimensions and synthetic composition/touch are never
substitutes. Package-specific single-instance, permissions, host service and
hardware restrictions still apply; unsupported contexts fail explicitly.

Delivery uses a local fast-forward merge preserving the starting local main.
The user excludes Redeven push, PR creation, pre-push and the complete integration
gate. Local Desktop/companion Runtime deployment records the merged commit, bundled
helper and readiness separately from upstream release evidence.

# Evidence

- [Upstream v0.21.0 release](https://github.com/floegence/floe-native-apps/releases/tag/v0.21.0): immutable module and component contract.
- [Exact-tag Release gate](https://github.com/floegence/floe-native-apps/actions/runs/36353860373) and [same-commit qualification](https://github.com/floegence/floe-native-apps/actions/runs/36352416815): native dual-architecture qualification.
- [Published desktop qualification corpus](https://github.com/floegence/floe-native-apps/tree/v0.21.0/qualification/desktop_compatibility): pinned test definitions, prototype source identities and package/desktop limits.
- `internal/hostapps/package_installed_test.go` and `desktop_installed_test.go`: actual package and native saved-byte receipts.
- `internal/hostapps/component_update_test.go`, `linux_lifecycle_test.go` and `desktop_transport_linux_test.go`: retained instances, restart, takeover and request ownership.
- `scripts/check_host_application_input.mjs`, `host_application_native_acceptance.mjs` and `host_application_pointer_acceptance.mjs`: production browser/desktop rendering and application assertions.
- `scripts/check_host_application_lifecycle.mjs`: actual browser popup close events and recovery boundaries.
