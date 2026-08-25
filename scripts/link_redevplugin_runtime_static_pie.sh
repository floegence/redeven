#!/usr/bin/env bash
set -euo pipefail

# Rust 1.88 downgrades static PIE to StaticNoPicExe for built-in Linux GNU
# targets. The compiler driver and direct LLD interfaces require different
# argument shapes, so select the interface once before converting arguments.
direct_lld=false
if [[ "$(uname -s)" == "Darwin" && -z "${REDEVPLUGIN_STATIC_PIE_CC:-}" ]]; then
  direct_lld=true
fi

link_args=()
for argument in "$@"; do
  case "$argument" in
    -static|-no-pie)
      ;;
    -m64|-nostartfiles|-nodefaultlibs)
      if [[ "$direct_lld" == false ]]; then
        link_args+=("$argument")
      fi
      ;;
    -Wl,*)
      if [[ "$direct_lld" == true ]]; then
        IFS=',' read -r -a linker_arguments <<< "${argument#-Wl,}"
        link_args+=("${linker_arguments[@]}")
      else
        link_args+=("$argument")
      fi
      ;;
    *)
      link_args+=("$argument")
      ;;
  esac
done

if [[ "$direct_lld" == true ]]; then
  rust_sysroot="$(rustc --print sysroot)"
  rust_host="$(rustc -vV | sed -n 's/^host: //p')"
  compiler="$rust_sysroot/lib/rustlib/$rust_host/bin/rust-lld"
  [[ -x "$compiler" ]] || {
    echo "Rust LLD is required for Darwin Linux runtime cross-linking" >&2
    exit 127
  }
  exec "$compiler" -flavor gnu -pie "${link_args[@]}"
fi

exec "${REDEVPLUGIN_STATIC_PIE_CC:-cc}" "${link_args[@]}" -static-pie
