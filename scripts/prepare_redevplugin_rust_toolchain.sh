#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/prepare_redevplugin_rust_toolchain.sh \
    --toolchain <version> --target <rust-target>

Ensures that the exact Rust toolchain and target needed to build the published
ReDevPlugin runtime are available locally. Existing installations are reused
without contacting the Rust distribution server. Missing components are
downloaded with bounded retries for transient network failures only.

Environment:
  REDEVEN_RUSTUP_OFFLINE=1
      Never download Rust components. Fail with an actionable cache message
      when a component is missing. This does not disable manifest or Cargo
      downloads performed by the caller.
  REDEVEN_RUSTUP_MAX_ATTEMPTS=3
      Maximum attempts for a transient download failure (1-5).
  REDEVEN_RUSTUP_RETRY_DELAY_SECONDS=2
      Initial retry delay; exponential backoff is capped at 60 seconds (0-60).
  CARGO_HOME, RUSTUP_HOME, RUSTUP_DIST_SERVER, HTTPS_PROXY
      Standard Rustup location and network settings are preserved. No mirror
      is selected automatically. RUSTUP_DOWNLOAD_TIMEOUT defaults to 120 seconds.

Prints the prepared Cargo executable path on stdout; diagnostics use stderr.
USAGE
}

toolchain=""
target=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --toolchain) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; toolchain="$2"; shift 2 ;;
    --target) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; target="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unexpected argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

die() {
  echo "[redevplugin-rust] $*" >&2
  exit 1
}

[[ "$toolchain" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid Rust toolchain: $toolchain"
[[ "$target" =~ ^[A-Za-z0-9_]+-[A-Za-z0-9_]+-[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*$ ]] || die "invalid Rust target: $target"

parse_bounded_integer() {
  local name="$1"
  local value="$2"
  local minimum="$3"
  local maximum="$4"
  [[ "$value" =~ ^(0|[1-9][0-9]?)$ ]] || die "$name must be an integer between $minimum and $maximum"
  (( value >= minimum && value <= maximum )) || die "$name must be between $minimum and $maximum"
  printf '%s\n' "$value"
}

max_attempts=$(parse_bounded_integer REDEVEN_RUSTUP_MAX_ATTEMPTS "${REDEVEN_RUSTUP_MAX_ATTEMPTS:-3}" 1 5)
retry_delay=$(parse_bounded_integer REDEVEN_RUSTUP_RETRY_DELAY_SECONDS "${REDEVEN_RUSTUP_RETRY_DELAY_SECONDS:-2}" 0 60)
offline="${REDEVEN_RUSTUP_OFFLINE:-0}"
[[ "$offline" == 0 || "$offline" == 1 ]] || die "REDEVEN_RUSTUP_OFFLINE must be 0 or 1"

command -v rustup >/dev/null 2>&1 || die "rustup is required"
rustup_bin=$(command -v rustup)
rustup_cargo_home="${CARGO_HOME:-$(cd -- "$(dirname -- "$rustup_bin")/.." >/dev/null 2>&1 && pwd -P)}"
rustup_home="${RUSTUP_HOME:-${HOME:?HOME is required}/.rustup}"
rustup_exec() {
  CARGO_HOME="$rustup_cargo_home" RUSTUP_HOME="$rustup_home" \
    RUSTUP_AUTO_INSTALL=0 RUSTUP_DOWNLOAD_TIMEOUT="${RUSTUP_DOWNLOAD_TIMEOUT:-120}" \
    LC_ALL=C "$rustup_bin" "$@"
}

# A probe must never trigger Rustup's optional automatic installation.
# Download policy belongs only to the explicit install commands below.
output_file=""
trap 'if [[ -n "$output_file" ]]; then rm -f "$output_file"; fi' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

is_transient_download_failure() {
  # An earlier transient diagnostic cannot hide a later integrity failure.
  if LC_ALL=C grep -Eiq 'checksum.*(fail|mismatch)|signature|certificate|invalid manifest|malformed|no release found|toolchain.*does not exist|not installable|permission denied|no space left' "$output_file"; then
    return 1
  fi
  LC_ALL=C grep -Eiq 'tls handshake eof|handshake.*unexpected eof|unexpected eof|timed out|timeout|connection (reset|refused|closed)|network is unreachable|temporary failure|temporarily unavailable|could not resolve host|dns error|http[^[:digit:]]*(429|500|502|503|504)([^[:digit:]]|$)' "$output_file"
}

retry_download() {
  local label="$1"
  shift
  local attempt=1
  local delay status
  if [[ -z "$output_file" ]]; then
    output_file=$(mktemp "${TMPDIR:-/tmp}/redevplugin-rustup.XXXXXX")
  fi
  while true; do
    if rustup_exec "$@" >"$output_file" 2>&1; then
      cat "$output_file" >&2
      return 0
    else
      status=$?
    fi
    if (( status >= 128 )); then exit "$status"; fi
    cat "$output_file" >&2
    if ! is_transient_download_failure; then
      die "$label failed with a non-retryable Rustup error"
    fi
    if (( attempt >= max_attempts )); then
      die "$label failed after $attempt attempts; check HTTPS_PROXY / RUSTUP_DIST_SERVER or preinstall with: rustup toolchain install $toolchain --profile minimal --target $target --no-self-update"
    fi
    delay=$(( retry_delay * (1 << (attempt - 1)) ))
    (( delay > 60 )) && delay=60
    echo "[redevplugin-rust] $label hit a transient network error; retrying in ${delay}s (attempt $((attempt + 1))/$max_attempts)" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

if ! toolchain_cargo=$(rustup_exec which --toolchain "$toolchain" cargo 2>/dev/null); then
  if [[ "$offline" == 1 ]]; then
    die "Rust toolchain $toolchain is not installed and offline mode is enabled; prepare it online with: rustup toolchain install $toolchain --profile minimal --target $target --no-self-update"
  fi
  retry_download "install Rust toolchain $toolchain" toolchain install "$toolchain" --profile minimal --no-self-update
  toolchain_cargo=$(rustup_exec which --toolchain "$toolchain" cargo) || die "Rust toolchain $toolchain installation did not provide Cargo"
fi
toolchain_rustc=$(rustup_exec which --toolchain "$toolchain" rustc) || die "Rust toolchain $toolchain is missing rustc"
[[ "$toolchain_cargo" == /* && -x "$toolchain_cargo" && -x "$toolchain_rustc" ]] || die "Rust toolchain $toolchain executables are unavailable"
rustc_version=$("$toolchain_rustc" --version) || die "Rust toolchain $toolchain cannot execute rustc"
[[ "$rustc_version" == "rustc $toolchain "* ]] || die "Rust toolchain $toolchain reports an unexpected compiler version: $rustc_version"

targets=$(rustup_exec target list --toolchain "$toolchain" --installed) || die "cannot inspect installed targets for Rust $toolchain"
if ! awk -v wanted="$target" '$1 == wanted { found=1 } END { exit(found ? 0 : 1) }' <<<"$targets"; then
  if [[ "$offline" == 1 ]]; then
    die "Rust target $target is not installed for toolchain $toolchain and offline mode is enabled; prepare it online with: rustup target add --toolchain $toolchain $target"
  fi
  retry_download "install Rust target $target" target add --toolchain "$toolchain" "$target"
  targets=$(rustup_exec target list --toolchain "$toolchain" --installed) || die "cannot inspect installed targets for Rust $toolchain"
  awk -v wanted="$target" '$1 == wanted { found=1 } END { exit(found ? 0 : 1) }' <<<"$targets" || die "Rust target $target is still unavailable after installation"
fi

echo "[redevplugin-rust] Rust toolchain $toolchain and target $target are ready" >&2
printf '%s\n' "$toolchain_cargo"
