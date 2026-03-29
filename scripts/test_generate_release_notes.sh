#!/usr/bin/env bash
set -euo pipefail

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
script_path="${repo_root}/scripts/generate_release_notes.sh"
tmpdir="$(mktemp -d)"

cleanup() {
  rm -rf "${tmpdir}"
}

trap cleanup EXIT

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

commit_with_message() {
  local repo_dir="$1"
  local message="$2"
  local file_path="${repo_dir}/history.txt"

  printf '%s\n' "$message" >> "$file_path"
  git -C "$repo_dir" add history.txt
  git -C "$repo_dir" commit -qm "$message"
}

git init -q "$tmpdir"
git -C "$tmpdir" config user.name "Release Notes Test"
git -C "$tmpdir" config user.email "release-notes-test@example.com"

commit_with_message "$tmpdir" "chore: bootstrap release flow"
git -C "$tmpdir" tag v0.1.0

commit_with_message "$tmpdir" "feat(codex): render user turns from structured inputs"
commit_with_message "$tmpdir" "fix(git-browser): lazy-load diff content"
commit_with_message "$tmpdir" "feat(envapp): add debug console mode"
commit_with_message "$tmpdir" "chore(deps): bump floeterm to v0.4.9"
git -C "$tmpdir" tag v0.1.1

release_notes_path="${tmpdir}/release-notes-v0.1.1.md"
(
  cd "$tmpdir"
  GITHUB_REPOSITORY="test/redeven-agent" sh "$script_path" v0.1.1 "$release_notes_path"
)

assert_contains "$release_notes_path" "## Release Highlights"
assert_contains "$release_notes_path" "- Codex workspace: render user turns from structured inputs."
assert_contains "$release_notes_path" "- Workspace UI: add debug console mode."
assert_contains "$release_notes_path" "- Git tools: lazy-load diff content."
assert_contains "$release_notes_path" "- Maintenance: bump floeterm to v0.4.9."
assert_contains "$release_notes_path" "- Full commit diff: [v0.1.0...v0.1.1](https://github.com/test/redeven-agent/compare/v0.1.0...v0.1.1)"

commit_with_message "$tmpdir" "chore(deps-dev): bump brace-expansion"
git -C "$tmpdir" tag v0.1.2

maintenance_notes_path="${tmpdir}/release-notes-v0.1.2.md"
(
  cd "$tmpdir"
  GITHUB_REPOSITORY="test/redeven-agent" sh "$script_path" v0.1.2 "$maintenance_notes_path"
)

assert_contains "$maintenance_notes_path" "## Release Highlights"
assert_contains "$maintenance_notes_path" "- Maintenance: bump brace-expansion."

invalid_output="${tmpdir}/invalid.out"
invalid_error="${tmpdir}/invalid.err"

if (
  cd "$tmpdir"
  GITHUB_REPOSITORY="test/redeven-agent" sh "$script_path" bad-tag "${tmpdir}/invalid.md" >"$invalid_output" 2>"$invalid_error"
); then
  echo "expected invalid tag invocation to fail" >&2
  exit 1
fi

assert_contains "$invalid_error" "invalid release tag: bad-tag"

echo "release notes generator checks passed"
