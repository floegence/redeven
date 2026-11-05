#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/redeven-ubuntu-desktop.XXXXXX")"
cleanup() {
  local status=$?
  if [[ -s "$temporary/container" ]]; then
    docker rm --force "$(cat "$temporary/container")" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$temporary"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

image='ubuntu@sha256:6a06111c3b0a8600feadb270aec771dc239bf407b25625f93f44ab00e11f4d3c'
docker pull "$image"
architecture="$(docker image inspect "$image" --format '{{.Architecture}}')"
[[ "$architecture" == arm64 || "$architecture" == amd64 ]] || { echo 'Unsupported Ubuntu architecture.' >&2; exit 2; }
GOOS=linux GOARCH="$architecture" CGO_ENABLED=0 GOWORK=off go test -c ./internal/ai -o "$temporary/ai.test"

# No host desktop, D-Bus socket, home directory, or input device is mounted.
docker run --rm --cidfile "$temporary/container" --label redeven.qualification=computer-ubuntu-setup \
  -v "$temporary:/qualification:ro" "$image" /bin/bash -ceu '
    export DEBIAN_FRONTEND=noninteractive
    apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=60 update -qq
    apt-get install -y -qq --reinstall --no-install-recommends --no-remove \
      xvfb openbox xdotool imagemagick-7.q16 xauth x11-utils dbus-daemon at-spi2-core xterm xfonts-base python3-gi gir1.2-gtk-3.0 >/tmp/install.log 2>&1 || { tail -80 /tmp/install.log; exit 1; }
    rm /usr/bin/xdotool
    apt-get install -y -qq --reinstall --no-install-recommends --no-remove xdotool >/tmp/repair.log 2>&1 || { cat /tmp/repair.log; exit 1; }
    test -x /usr/bin/xdotool
    REDEVEN_XVFB_INTEGRATION=1 /qualification/ai.test -test.run "^TestATSPI|^TestPrivateDesktopEnvironment|^TestX11|^TestVerifyComputerDesktop|^TestXvfbTargetExecutorRealDisplay" -test.v -test.timeout=120s
  '
