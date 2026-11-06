// Trusted package bytes define cache identities. Cache hits never replace
// manager ownership checks, administrator authorization or Runtime admission.
export const desktopTransferNames = ['floe-host-desktop-service', 'desktop-drm', 'libdrmtap.LICENSE', 'redeven'] as const;
export type DesktopTransferName = typeof desktopTransferNames[number];
export type DesktopTransferFile = Readonly<{ name: DesktopTransferName; sha256: string; size: number }>;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const cacheSetup = `set -eu
umask 077
uid=$(id -u)
safe_directory() {
  if [ ! -e "$1" ] && [ ! -L "$1" ]; then mkdir -m 0700 -- "$1" 2>/dev/null || [ -d "$1" ]; fi
  [ ! -L "$1" ]
  [ -d "$1" ]
  [ "$(stat -c %u -- "$1")" = "$uid" ]
  mode=$(stat -c %a -- "$1")
  [ "$((0$mode & 0022))" = 0 ]
}
safe_directory "$HOME"
safe_directory "$HOME/.cache"
safe_directory "$HOME/.cache/redeven"
cache="$HOME/.cache/redeven/desktop-transfer-v1"
safe_directory "$cache"
[ "$(stat -c %a -- "$cache")" = 700 ]`;

export function desktopTransferProbeCommand(files: readonly DesktopTransferFile[]): string {
  return `${cacheSetup}
stage=$(mktemp -d /tmp/redeven-desktop-ssh-XXXXXX)
trap 'rm -rf -- "$stage"' EXIT
trap 'exit 1' HUP INT TERM
printf '%s\\n' "$stage"
${files.map(file => `name=${quote(file.name)}
if [ ! -L "$cache/$name" ] && [ -f "$cache/$name" ] && [ "$(stat -c %u:%s:%a -- "$cache/$name")" = "$uid:${file.size}:400" ]; then
  cp -P --reflink=auto -- "$cache/$name" "$stage/$name"
  if [ ! -L "$stage/$name" ] && [ -f "$stage/$name" ] && printf '%s  %s\\n' ${quote(file.sha256)} "$stage/$name" | sha256sum -c - >/dev/null 2>&1; then
    chmod 0600 -- "$stage/$name"
  else
    rm -f -- "$stage/$name"
    printf '%s\\n' "$name"
  fi
else
  printf '%s\\n' "$name"
fi`).join('\n')}
trap - EXIT HUP INT TERM`;
}

export function desktopTransferPublishCommand(directory: string, files: readonly DesktopTransferFile[]): string {
  return `${cacheSetup}
stage=${quote(directory)}
temporary=''
trap 'if [ -n "$temporary" ]; then rm -f -- "$temporary"; fi' EXIT
trap 'exit 1' HUP INT TERM
${files.map(file => `name=${quote(file.name)}
[ ! -L "$stage/$name" ]
[ -f "$stage/$name" ]
[ "$(stat -c %s -- "$stage/$name")" = ${quote(String(file.size))} ]
printf '%s  %s\\n' ${quote(file.sha256)} "$stage/$name" | sha256sum -c - >/dev/null
temporary=$(mktemp "$cache/.upload-XXXXXX")
cp --reflink=auto -- "$stage/$name" "$temporary"
chmod 0400 -- "$temporary"
mv -fT -- "$temporary" "$cache/$name"
temporary=''`).join('\n')}`;
}
