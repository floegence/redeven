#!/usr/bin/env bash
set -euo pipefail

# Rust 1.88 downgrades static PIE to StaticNoPicExe for built-in Linux GNU
# targets. Remove the conflicting driver flags so GCC selects static PIE.
darwin_link=false
[[ "$(uname -s)" == "Darwin" ]] && darwin_link=true
link_args=()
for argument in "$@"; do
  case "$argument" in
    -static|-no-pie)
      ;;
    -nostartfiles|-nodefaultlibs)
      # Rust already supplies the target startup objects and libraries.
      ;;
    -Wl,*)
      if [[ "$darwin_link" == true ]]; then
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

compiler_args=()
compiler="${REDEVPLUGIN_STATIC_PIE_CC:-cc}"
link_mode=(-static-pie)
if [[ "$darwin_link" == true && -z "${REDEVPLUGIN_STATIC_PIE_CC:-}" ]]; then
  rust_sysroot="$(rustc --print sysroot)"
  rust_host="$(rustc -vV | sed -n 's/^host: //p')"
  compiler="$rust_sysroot/lib/rustlib/$rust_host/bin/rust-lld"
  [[ -x "$compiler" ]] || {
    echo "Rust LLD is required for Darwin Linux runtime cross-linking" >&2
    exit 127
  }
  compiler_args=(-flavor gnu -pie)
  link_mode=()
fi

if [[ "${#link_mode[@]}" -gt 0 ]]; then
  exec "$compiler" "${compiler_args[@]}" "${link_args[@]}" "${link_mode[@]}"
fi
exec "$compiler" "${compiler_args[@]}" "${link_args[@]}"
