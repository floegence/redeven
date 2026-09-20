---
type: Operations Guide
title: Prepare Linux hosts for native applications
description: Install the Xpra 6, HTML5 and GIO stack on Arch, Enterprise Linux 9 and Alpine without a desktop environment.
tags: [runtime, applications, linux, installation]
timestamp: 2026-09-20T10:00:00Z
---
# Summary

Administrators install the host packages; Redeven detects their actual
capabilities and starts private X11 application sessions as the Runtime user.
No desktop environment, connected monitor, container, virtual machine, or
systemd user session is required in production. Package names alone do not prove
readiness: Xpra 6.x, HTML5 v20/v21 and working GIO/GTK 3 must all be available.
Refresh the application library after changing the installation. Missing or
incompatible dependencies prevent launch and appear in the library; Redeven
does not run these privileged installation commands automatically.

The [platform contract](../architecture/host-application-platforms.md) owns
capability detection, isolation, application restrictions and validation evidence.

# Arch Linux

Use Arch's official x86_64 repositories and perform a complete system upgrade:

```sh
sudo pacman -Syu
sudo pacman -S --needed xpra xorg-server-xvfb xorg-xauth dbus python-gobject gtk3 librsvg hicolor-icon-theme
```

The tested package is Xpra 6.4.4. Install HTML5 v20 or v21 using the procedure below
when the package does not include a compatible client. Arch Linux ARM is a
separate distribution and is not covered by the official Arch x86_64 package
result. XTerm is an optional small application for the installed-stack tests:
`sudo pacman -S --needed xterm`.

# RHEL, Rocky Linux and AlmaLinux 9

This route targets x86_64, where Xpra publishes Enterprise Linux 9 packages.
The tested upstream repositories do not publish EL9 aarch64 packages. Do not
substitute x86_64 packages on ARM or select EPEL's Xpra 5.x LTS package. ARM hosts
need a separately prepared and validated upstream Xpra 6 source installation.

Rocky and AlmaLinux use EPEL and CRB:

```sh
sudo dnf install -y epel-release dnf-plugins-core
sudo dnf config-manager --set-enabled crb
```

RHEL needs a valid subscription and its BaseOS, AppStream and CodeReady Builder
repositories. Enable the matching optional repository before EPEL:

```sh
sudo subscription-manager repos --enable codeready-builder-for-rhel-9-x86_64-rpms
sudo dnf install -y https://dl.fedoraproject.org/pub/epel/epel-release-latest-9.noarch.rpm
```

Choose the upstream repository for the actual distribution; inspect its signed
repository configuration before installing it:

| Distribution | Upstream repository configuration |
| --- | --- |
| Rocky Linux 9 | `https://raw.githubusercontent.com/Xpra-org/xpra/master/packaging/repos/rockylinux/xpra.repo` |
| AlmaLinux 9 | `https://raw.githubusercontent.com/Xpra-org/xpra/master/packaging/repos/almalinux/xpra.repo` |

Save the chosen configuration as `/etc/yum.repos.d/xpra.repo`, retaining package
signature verification and the upstream key. For RHEL 9 use the actual upstream
RedHat repository (the upstream source tree does not provide a RedHat `.repo`
download):

```ini
[xpra]
name=Xpra for RHEL 9
enabled=1
gpgcheck=1
gpgkey=https://xpra.org/gpg.asc
baseurl=https://xpra.org/stable/RedHat/9/$basearch/
```

Then install:

```sh
sudo dnf install -y xpra xpra-x11 xpra-html5 xorg-x11-server-Xvfb xorg-x11-xauth dbus-daemon python3-gobject gtk3 gobject-introspection librsvg2 hicolor-icon-theme
```

The tested stack is Xpra 6.5.3 and HTML5 v21. Xpra uses Python 3.12 while the
system GIO bindings use Python 3.9; Redeven deliberately resolves them
independently. `librsvg2` supplies SVG icon loading for applications that use it.
Install `xterm` separately to run the opt-in integration tests.

UBI minimal images do not include the full subscribed RHEL package set. In
particular, the tested UBI 9 repositories lacked Xvfb. UBI initialization is not
evidence of full RHEL validation. SELinux policy remains enabled and owned by
the administrator; image tests do not certify a booted RHEL host's policy.

# Alpine Linux 3.23

Enable the matching release's official `main` and `community` repositories:

```sh
sudo apk add xpra xvfb xauth dbus py3-gobject3 gtk+3.0 librsvg hicolor-icon-theme
```

Alpine's Xpra 6.2.2 is supported, but its tested `xpra-webclient` package was
17.1 and is incompatible with the viewer adapter. Install upstream HTML5 v20
or v21 using the next section. `xterm` is optional for integration tests.

Use Redeven's portable Linux Runtime built by `scripts/build_runtime_binary.sh`.
It retains the published native Floeterm engine and statically links its GNU
libraries, so Alpine does not need a GNU loader or `gcompat`. A previous dynamic
GNU Runtime can fail before startup with `not found` even though its file exists.
The compatibility loader is not a supported repair: it also changes executable
path resolution and breaks discovery of the adjacent plugin runtime.
The [runtime dependency contract](../architecture/runtime-transport-dependencies.md)
owns the static build, resolver and library distribution boundaries.

# Install a compatible upstream HTML5 client

Prefer the distribution/upstream signed `xpra-html5` package when it supplies
v20 or v21. Otherwise install the separately released upstream source using its
installer; copying a distribution's web directory can preserve broken links to
JavaScript libraries outside that directory.

The following pinned v20 archive was used in the compatibility checks. Download
and verify it before running its installer. Use a fresh working directory:

```sh
curl -fL https://github.com/Xpra-org/xpra-html5/archive/refs/tags/v20.tar.gz -o html5-v20.tar.gz
printf '%s  %s\n' fe710c3df84c34a55fdde21f8eda82437ef9fe457fcc0bf1ff6f138ab6b4ab3d html5-v20.tar.gz | sha256sum -c -
mkdir html5-source
tar -xzf html5-v20.tar.gz -C html5-source --strip-components=1
cd html5-source
sudo python3 setup.py install / /usr/share/xpra/www /usr/share/xpra/www
```

The example uses the tested system resource root `/usr/share/xpra`. For a custom
prefix, obtain `resources` from `xpra path-info` under the Runtime's environment
and use its `www` directory instead. A virtual environment can have a different
resource root. Do not change another package's managed files without first
resolving package ownership. Keep the client updated within the validated major
versions; a new major requires adapter verification.

# Verify the prepared host

Run as the same account and with the same PATH as Redeven:

```sh
xpra --version
xpra path-info
python3 -c 'import gi; gi.require_version("Gtk", "3.0"); from gi.repository import Gio, Gtk; assert Gio.DesktopAppInfo'
REDEVEN_TEST_HOST_APPLICATIONS=1 GOWORK=off go test ./internal/hostapps -run TestInstalled -count=1 -v
```

The last command runs from a Redeven source checkout with Go and XTerm installed.
It tests native metadata/icons, literal launch arguments, isolated launch,
nonempty X11 window inventory, resume, explicit termination, and exclusion of
unrelated host Xpra configuration. Finally open an installed application in
Redeven and verify input, reconnect and application-initiated window closure.

# macOS

Use the packaged native helper on macOS 13 or newer. Local Desktop opens the
installed app directly. Remote capture requires a logged-in, unlocked desktop and
screen-recording/accessibility grants; the application library presents explicit
permission actions. Refresh after changing macOS Privacy & Security settings.
See the [native Mac contract](../architecture/macos-host-applications.md) for shared
foreground input, singleton and capture limitations. Linux package commands above
do not apply to macOS.

# Evidence

- `internal/hostapps/dependencies.go`: executable, Python, server and client checks.
- `internal/hostapps/manager_test.go`: opt-in installed-stack checks.
- `scripts/build_runtime_binary.sh`: portable Linux native Runtime build.
- [Arch Xpra package](https://archlinux.org/packages/extra/x86_64/xpra/): official architecture and dependencies.
- [Alpine packages](https://pkgs.alpinelinux.org/packages?name=xpra*&branch=v3.23): Xpra and web client are independently versioned.
- [Xpra package repositories](https://github.com/Xpra-org/xpra/tree/master/packaging/repos): signed distribution repository configurations.
- [HTML5 client v20](https://github.com/Xpra-org/xpra-html5/tree/v20): upstream installation and assets.
