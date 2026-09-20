#!/usr/bin/env bash
set -euo pipefail

# Release runners use Ubuntu's native GNU toolchain and enabled deb-src indexes.
# Fetch the exact installed libc source, never a "latest" upstream approximation.
relink_root=$1
archive=$2
mkdir -p "$relink_root/libc-source" "$relink_root/licenses"
libc_archive=$(realpath "$(gcc -print-file-name=libc.a)")
libc_package=$(dpkg-query -S "$libc_archive" | head -n 1 | sed 's/: \/.*//')
source_package=$(dpkg-query -W -f='${source:Package}' "$libc_package")
source_version=$(dpkg-query -W -f='${source:Version}' "$libc_package")
[[ "$source_package" == glibc && -n "$source_version" ]]
(
  cd "$relink_root/libc-source"
  apt-get source --download-only "$source_package=$source_version"
)
cp -L /usr/share/doc/libc6/copyright "$relink_root/licenses/glibc-copyright.txt"
cp -L /usr/share/doc/libstdc++6/copyright "$relink_root/licenses/gcc-copyright.txt"
cp LICENSE THIRD_PARTY_NOTICES.md "$relink_root/"
{
  printf 'glibc source: %s=%s\n' "$source_package" "$source_version"
  gcc --version
  go version
  printf 'Redeven commit: %s\n' "$(git rev-parse HEAD)"
} > "$relink_root/build.txt"
cat > "$relink_root/RELINK.txt" <<'TEXT'
This kit accompanies the Linux Redeven and Gateway binaries from the same release.
It contains the complete linked work as relocatable Go/C objects and native
archives, the matching GNU libc source package (including downstream patches),
and the relevant licenses. Redeven permits modification and reverse engineering
for debugging modifications to the LGPL library as required by LGPL 2.1 section 6.

On a matching Linux CPU, install GNU gcc/g++ with static development libraries
and Python 3. Run: python3 redeven/relink.py
For Gateway run: python3 redeven-gateway/relink.py
Set CC to a matching GNU cross compiler if building on another platform.
To use a modified GNU libc, build the enclosed source with your changes, install
it into a sysroot, then run the script with --sysroot=/absolute/path/to/sysroot
and any additional compiler options needed by that toolchain.
The output binary is written next to relink.py. Replace the original executable
in your runtime directory while retaining the accompanying plugin runtime files.
No signing key or Redeven service is required to run a relinked local runtime.

Redistributors must retain the notices and provide this matching kit, including
the library source, from the same download location as the binary. The kit does
not change the licenses of Redeven or its other components.
TEXT
tar -C "$relink_root" -czf "$archive" .
