#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/redeven-private-desktop.XXXXXX")"
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

image='lscr.io/linuxserver/webtop@sha256:9092b349d525f765b0be912db1ec5a8d5aa97b0f1a3b57da27a7f72e69c90825'
docker pull "$image"
architecture="$(docker image inspect "$image" --format '{{.Architecture}}')"
[[ "$architecture" == arm64 || "$architecture" == amd64 ]] || { echo 'Unsupported private desktop architecture.' >&2; exit 2; }
GOOS=linux GOARCH="$architecture" CGO_ENABLED=0 GOWORK=off go test -c ./internal/ai -o "$temporary/ai.test"

# No host DISPLAY, D-Bus socket, home, browser profile or input device is mounted.
# Each executor starts its own Xvfb and accessibility bus inside this container.
docker run --rm --cidfile "$temporary/container" --entrypoint /bin/bash \
  --label redeven.qualification=computer-private-desktop \
  -v "$temporary:/qualification:ro" "$image" -ceu '
    timeout --kill-after=10s 600 bash -ceu '\''
      sed -i -e "/^deb-src /d" -e "s|http://deb.debian.org/|https://deb.debian.org/|g" -e "s|http://security.debian.org/|https://deb.debian.org/|g" /etc/apt/sources.list
      rm -f /etc/apt/sources.list.d/docker.list /etc/apt/sources.list.d/nodesource.sources
      apt-get -o Acquire::Retries=1 -o Acquire::https::Timeout=30 update --error-on=any -qq
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb openbox xdotool imagemagick xauth x11-utils xterm dbus at-spi2-core python3-gi gir1.2-gtk-3.0
    '\''
    REDEVEN_XVFB_INTEGRATION=1 /qualification/ai.test -test.run "^TestATSPI|^TestPrivateDesktopEnvironment|^TestX11Action|^TestXvfbTargetExecutorRealDisplay" -test.v -test.timeout=90s
  '
