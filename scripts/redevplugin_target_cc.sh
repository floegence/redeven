#!/usr/bin/env bash
set -euo pipefail
zig="$1"
zig_target="$2"
rust_target="$3"
shift 3
arguments=()
for argument in "$@"; do
  case "$argument" in
    "--target=$rust_target") ;; # cc-rs detects Clang and injects the Rust triple.
    *) arguments+=("$argument") ;;
  esac
done
exec "$zig" cc -target "$zig_target" -fPIC -fno-sanitize=undefined "${arguments[@]}"
