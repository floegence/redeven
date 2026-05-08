#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
script_path="${repo_root}/scripts/open_source_hygiene_check.sh"
gitleaks_config="${repo_root}/.gitleaks.toml"

assert_contains() {
  local path="$1"
  local needle="$2"

  if ! grep -Fq -- "$needle" "$path"; then
    echo "expected to find in ${path}: ${needle}" >&2
    echo "--- file contents ---" >&2
    cat "$path" >&2
    exit 1
  fi
}

create_fixture_repo() {
  local root="$1"

  mkdir -p "${root}/scripts" "${root}/docs" "${root}/internal/agent"
  cp "$script_path" "${root}/scripts/open_source_hygiene_check.sh"
  cp "$gitleaks_config" "${root}/.gitleaks.toml"

  git init -q "$root"
  git -C "$root" config user.name "Open Source Hygiene Test"
  git -C "$root" config user.email "open-source-hygiene-test@example.com"
}

write_allowed_contract_files() {
  local root="$1"

  cat >"${root}/README.md" <<'EOF'
The public installer endpoint is https://redeven.com/install.sh.
EOF

  cat >"${root}/docs/RELEASE.md" <<'EOF'
The public manifest endpoint is https://version.agent.redeven.com/v1/manifest.json.
Solid <Portal>, body-level portal, overlay portal, and npm portal: are technical terms.
EOF

  cat >"${root}/internal/agent/upgrade.go" <<'EOF'
package agent

const defaultUpgradeInstallScriptURL = "https://redeven.com/install.sh"
EOF
}

run_check() {
  local root="$1"
  local output="$2"
  local error="$3"

  (
    cd "$root"
    ./scripts/open_source_hygiene_check.sh --all >"$output" 2>"$error"
  )
}

track_fixture_files() {
  local root="$1"
  git -C "$root" add README.md docs/RELEASE.md internal/agent/upgrade.go scripts/open_source_hygiene_check.sh .gitleaks.toml
}

allowed_repo="$(mktemp -d)"
bad_path_repo="$(mktemp -d)"
bad_domain_repo="$(mktemp -d)"
bad_product_repo="$(mktemp -d)"

cleanup() {
  rm -rf "$allowed_repo" "$bad_path_repo" "$bad_domain_repo" "$bad_product_repo"
}

trap cleanup EXIT

create_fixture_repo "$allowed_repo"
write_allowed_contract_files "$allowed_repo"
track_fixture_files "$allowed_repo"
allowed_out="${allowed_repo}/allowed.out"
allowed_err="${allowed_repo}/allowed.err"
run_check "$allowed_repo" "$allowed_out" "$allowed_err"
assert_contains "$allowed_out" "[INFO] open-source hygiene check passed (--all)"

create_fixture_repo "$bad_path_repo"
write_allowed_contract_files "$bad_path_repo"
cat >"${bad_path_repo}/docs/bad.md" <<'EOF'
Do not use https://redeven.com/upgrade here.
EOF
git -C "$bad_path_repo" add README.md docs/RELEASE.md docs/bad.md internal/agent/upgrade.go scripts/open_source_hygiene_check.sh .gitleaks.toml
bad_path_out="${bad_path_repo}/bad-path.out"
bad_path_err="${bad_path_repo}/bad-path.err"
if run_check "$bad_path_repo" "$bad_path_out" "$bad_path_err"; then
  echo "expected invalid redeven.com path to fail hygiene check" >&2
  exit 1
fi
assert_contains "$bad_path_err" "Only the public runtime endpoint literals https://redeven.com/install.sh and https://version.agent.redeven.com/v1/manifest.json may appear"

create_fixture_repo "$bad_domain_repo"
write_allowed_contract_files "$bad_domain_repo"
cat >"${bad_domain_repo}/docs/bad.md" <<'EOF'
Do not use https://agent.package.redeven.com/v1/runtime.tgz here.
EOF
git -C "$bad_domain_repo" add README.md docs/RELEASE.md docs/bad.md internal/agent/upgrade.go scripts/open_source_hygiene_check.sh .gitleaks.toml
bad_domain_out="${bad_domain_repo}/bad-domain.out"
bad_domain_err="${bad_domain_repo}/bad-domain.err"
if run_check "$bad_domain_repo" "$bad_domain_out" "$bad_domain_err"; then
  echo "expected private delivery domain to fail hygiene check" >&2
  exit 1
fi
assert_contains "$bad_domain_err" "Only the public runtime endpoint literals https://redeven.com/install.sh and https://version.agent.redeven.com/v1/manifest.json may appear"

create_fixture_repo "$bad_product_repo"
write_allowed_contract_files "$bad_product_repo"
git -C "$bad_product_repo" add README.md docs/RELEASE.md internal/agent/upgrade.go scripts/open_source_hygiene_check.sh .gitleaks.toml
blocked_product_terms=(
  "redeven""-portal"
  "redeven""_portal"
  "Redeven ""Portal"
  "REDEVEN""_PORTAL"
  "Portal ""session"
  "Region ""Portal"
  "Portal ""console"
  "portal""Origin"
  "portal""BaseDomain"
  "build""PortalEnvRecoverURL"
  "redirectTo""PortalForEnvSessionRecovery"
  "case '""portal""'"
)
for blocked_product_term in "${blocked_product_terms[@]}"; do
  printf 'Do not leak %s.\n' "$blocked_product_term" >"${bad_product_repo}/docs/bad.md"
  git -C "$bad_product_repo" add docs/bad.md
  bad_product_out="${bad_product_repo}/bad-product.out"
  bad_product_err="${bad_product_repo}/bad-product.err"
  if run_check "$bad_product_repo" "$bad_product_out" "$bad_product_err"; then
    echo "expected private control-plane product naming to fail hygiene check for ${blocked_product_term}" >&2
    exit 1
  fi
  assert_contains "$bad_product_out" "$blocked_product_term"
  assert_contains "$bad_product_err" "Private control-plane product naming must not appear in this public repository."
done

echo "open-source hygiene checks passed"
