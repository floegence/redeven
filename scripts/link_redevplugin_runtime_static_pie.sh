#!/usr/bin/env bash
set -euo pipefail

# Rust 1.88 downgrades static PIE to StaticNoPicExe for built-in Linux GNU
# targets. Remove the conflicting driver flags so GCC selects static PIE.
link_args=()
for argument in "$@"; do
  case "$argument" in
    -static|-no-pie)
      ;;
    *)
      link_args+=("$argument")
      ;;
  esac
done

exec "${REDEVPLUGIN_STATIC_PIE_CC:-cc}" "${link_args[@]}" -static-pie
