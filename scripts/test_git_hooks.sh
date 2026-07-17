#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)

fail() {
  echo "git hook contract test failed: $*" >&2
  exit 1
}

if grep -Eq 'build_assets|check_plugin_integration|check_gateway_protocol_contract|check_desktop|check_docker_runtime_e2e|check_final_integration' "$ROOT_DIR/.githooks/pre-commit"; then
  fail "pre-commit must contain only fast commit-time checks"
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
repo="$tmpdir/repo"
gate_log="$tmpdir/gate.log"

git init -q -b main "$repo"
git -C "$repo" config user.name "Redeven Hook Test"
git -C "$repo" config user.email "hook-test@invalid.example"
mkdir -p "$repo/.githooks" "$repo/scripts"
cp "$ROOT_DIR/.githooks/pre-push" "$repo/.githooks/pre-push"
chmod +x "$repo/.githooks/pre-push"

cat >"$repo/scripts/check_final_integration.sh" <<'FAKE_GATE'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$GATE_LOG"
FAKE_GATE
chmod +x "$repo/scripts/check_final_integration.sh"

printf 'base\n' >"$repo/fixture.txt"
git -C "$repo" add fixture.txt
git -C "$repo" commit -q -m "base"
base_oid="$(git -C "$repo" rev-parse HEAD)"
printf 'tip\n' >>"$repo/fixture.txt"
git -C "$repo" commit -q -am "tip"
tip_oid="$(git -C "$repo" rev-parse HEAD)"

run_hook() {
  local input="$1"
  local output="$2"
  (
    cd "$repo"
    printf '%s\n' "$input" | GATE_LOG="$gate_log" ./.githooks/pre-push origin test://origin
  ) >"$output" 2>&1
}

: >"$gate_log"
run_hook "refs/heads/feature $tip_oid refs/heads/feature $base_oid" "$tmpdir/feature.out"
[ ! -s "$gate_log" ] || fail "feature pushes must not run the final integration gate"

run_hook "refs/heads/main $tip_oid refs/heads/main $base_oid" "$tmpdir/main.out"
expected_args="--base $base_oid --tip $tip_oid"
[ "$(cat "$gate_log")" = "$expected_args" ] || fail "main push did not run the gate for the exact base and tip"

git -C "$repo" branch feature "$tip_oid"
git -C "$repo" switch -q feature
if run_hook "refs/heads/main $tip_oid refs/heads/main $base_oid" "$tmpdir/wrong-worktree.out"; then
  fail "main push from a non-main worktree must be rejected"
fi
grep -q "check out the local main worktree" "$tmpdir/wrong-worktree.out" || fail "wrong-worktree rejection was not actionable"

git -C "$repo" switch -q main
git -C "$repo" switch -q -c remote-side "$base_oid"
printf 'remote\n' >>"$repo/fixture.txt"
git -C "$repo" commit -q -am "remote side"
remote_oid="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" switch -q main
if run_hook "refs/heads/main $tip_oid refs/heads/main $remote_oid" "$tmpdir/diverged.out"; then
  fail "a non-fast-forward main push must be rejected before the full gate"
fi
grep -q "remote main moved or local main is not a fast-forward" "$tmpdir/diverged.out" || fail "non-fast-forward rejection was not actionable"

if run_hook "refs/heads/feature $tip_oid refs/heads/main $base_oid" "$tmpdir/wrong-source.out"; then
  fail "remote main must only be updated from the local main branch"
fi
grep -q "push main from the local main branch" "$tmpdir/wrong-source.out" || fail "wrong-source rejection was not actionable"

echo "[INFO] Git hook contract tests passed"
