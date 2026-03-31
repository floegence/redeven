#!/bin/sh
set -eu

release_tag="${1:-${RELEASE_TAG:-}}"
output_path="${2:-${RELEASE_NOTES_PATH:-dist/RELEASE_NOTES.md}}"
repo="${GITHUB_REPOSITORY:-floegence/redeven}"
install_script_url="${INSTALL_SCRIPT_URL:-}"
release_git_ref="${RELEASE_GIT_REF:-$release_tag}"
max_highlights="${RELEASE_NOTES_MAX_HIGHLIGHTS:-4}"
max_items_per_highlight="${RELEASE_NOTES_MAX_ITEMS_PER_HIGHLIGHT:-3}"

validate_release_tag() {
  case "$1" in
    v[0-9]*.[0-9]*.[0-9]*|v[0-9]*.[0-9]*.[0-9]*-[0-9A-Za-z.-]*|v[0-9]*.[0-9]*.[0-9]*+[0-9A-Za-z.-]*|v[0-9]*.[0-9]*.[0-9]*-[0-9A-Za-z.-]*+[0-9A-Za-z.-]*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

generate_release_highlights() {
  git log --no-merges --format='%s' "$1" | awk \
    -v max_categories="$max_highlights" \
    -v max_items="$max_items_per_highlight" '
function trim(value) {
  sub(/^[[:space:]]+/, "", value)
  sub(/[[:space:]]+$/, "", value)
  return value
}

function normalize_scope(scope) {
  scope = trim(scope)
  if (scope == "codexbridge" || scope ~ /^codex/) return "codex"
  if (scope ~ /^envapp/ || scope == "settings" || scope == "codespaces" || scope == "ui") return "workspace-ui"
  if (scope ~ /^git/) return "git"
  if (scope == "debug-console") return "debug-console"
  if (scope == "desktop" || scope ~ /^desktop-/) return "desktop"
  if (scope == "ask-user" || scope == "ai") return "ai"
  if (scope ~ /^deps(-dev)?$/) return "maintenance"
  if (scope == "") return "general"
  return scope
}

function titleize(raw,    value, parts, count, item_index, word, output) {
  value = raw
  gsub(/[-_]+/, " ", value)
  count = split(value, parts, /[[:space:]]+/)
  output = ""
  for (item_index = 1; item_index <= count; item_index++) {
    word = parts[item_index]
    if (word == "") continue
    word = tolower(word)
    word = toupper(substr(word, 1, 1)) substr(word, 2)
    output = output (output == "" ? "" : " ") word
  }
  if (output == "") return "General improvements"
  return output
}

function category_label(key) {
  if (key == "codex") return "Codex workspace"
  if (key == "workspace-ui") return "Workspace UI"
  if (key == "git") return "Git tools"
  if (key == "debug-console") return "Debug console"
  if (key == "desktop") return "Desktop shell"
  if (key == "ai") return "AI interactions"
  if (key == "maintenance") return "Maintenance"
  if (key == "general") return "General improvements"
  return titleize(key)
}

function type_weight(type) {
  if (type == "feat") return 5
  if (type == "fix" || type == "perf") return 3
  if (type == "refactor") return 2
  if (type == "docs" || type == "chore" || type == "build" || type == "ci" || type == "test") return 1
  return 2
}

function desc_priority(type) {
  if (type == "feat") return 1
  if (type == "fix" || type == "perf") return 2
  if (type == "refactor") return 3
  return 4
}

function is_maintenance_type(type) {
  return type == "docs" || type == "chore" || type == "build" || type == "ci" || type == "test"
}

function remember_category(key) {
  if (seen_category[key]) return
  seen_category[key] = 1
  categories[++category_count] = key
}

function remember_desc(key, priority, desc,    dedupe_key) {
  if (desc == "") return
  dedupe_key = key SUBSEP desc
  if (seen_desc[dedupe_key]) return
  seen_desc[dedupe_key] = 1
  descs[key, priority, ++desc_count[key, priority]] = desc
}

function compose_summary(key,    summary, priority, item_index, desc, pieces) {
  summary = ""
  pieces = 0
  for (priority = 1; priority <= 4 && pieces < max_items; priority++) {
    for (item_index = 1; item_index <= desc_count[key, priority] && pieces < max_items; item_index++) {
      desc = descs[key, priority, item_index]
      if (desc == "") continue
      summary = summary (summary == "" ? "" : "; ") desc
      pieces++
    }
  }
  return summary
}

{
  subject = trim($0)
  if (subject == "" || subject ~ /^Merge /) next

  type = "other"
  scope = ""
  desc = subject

  if (index(subject, ": ") > 0) {
    header = subject
    sub(/: .*/, "", header)

    desc = subject
    sub(/^[^:]*: /, "", desc)
    desc = trim(desc)

    type = header
    sub(/\(.*/, "", type)
    type = trim(type)

    if (header ~ /\(/) {
      scope = header
      sub(/^[^(]*\(/, "", scope)
      sub(/\)$/, "", scope)
      scope = trim(scope)
    }
  }

  key = normalize_scope(scope)
  if (is_maintenance_type(type) && key == "general") key = "maintenance"

  remember_category(key)
  category_score[key] += type_weight(type)
  category_commits[key]++
  remember_desc(key, desc_priority(type), desc)
}

END {
  if (category_count == 0) exit 0

  for (item_index = 1; item_index <= category_count; item_index++) {
    sorted[item_index] = categories[item_index]
  }

  for (left = 1; left <= category_count; left++) {
    best = left
    for (right = left + 1; right <= category_count; right++) {
      candidate = sorted[right]
      current = sorted[best]
      if (category_score[candidate] > category_score[current] || (category_score[candidate] == category_score[current] && category_commits[candidate] > category_commits[current])) {
        best = right
      }
    }

    swap = sorted[left]
    sorted[left] = sorted[best]
    sorted[best] = swap
  }

  printed = 0
  for (item_index = 1; item_index <= category_count && printed < max_categories; item_index++) {
    key = sorted[item_index]
    summary = compose_summary(key)
    if (summary == "") continue
    printf "- %s: %s.\n", category_label(key), summary
    printed++
  }
}'
}

if [ -z "$release_tag" ]; then
  echo "release tag is required (arg1 or RELEASE_TAG)" >&2
  exit 1
fi

if ! validate_release_tag "$release_tag"; then
  echo "invalid release tag: $release_tag" >&2
  exit 1
fi

if [ -z "$install_script_url" ]; then
  install_script_url="https://raw.githubusercontent.com/${repo}/${release_tag}/scripts/install.sh"
fi

output_dir=$(dirname "$output_path")
mkdir -p "$output_dir"

release_date=$(date -u +"%Y-%m-%d")
release_url="https://github.com/${repo}/releases"
compare_line=""
release_notes_ref=""
release_highlights=""

if git rev-parse --git-dir >/dev/null 2>&1; then
  previous_tag=$(git tag -l "v*" --sort=-version:refname | awk -v current="$release_tag" '$0 != current {print; exit}')
  if [ -n "$previous_tag" ]; then
    compare_url="https://github.com/${repo}/compare/${previous_tag}...${release_tag}"
    compare_line="- Full commit diff: [${previous_tag}...${release_tag}](${compare_url})"
  fi

  if git rev-parse --verify -q "${release_git_ref}^{commit}" >/dev/null 2>&1; then
    release_notes_ref="$release_git_ref"
  elif git rev-parse --verify -q "HEAD^{commit}" >/dev/null 2>&1; then
    release_notes_ref="HEAD"
  fi

  if [ -n "$release_notes_ref" ]; then
    log_range="$release_notes_ref"
    if [ -n "${previous_tag:-}" ]; then
      log_range="${previous_tag}..${release_notes_ref}"
    fi
    release_highlights=$(generate_release_highlights "$log_range" || true)
  fi
fi

if [ -z "$release_highlights" ]; then
  if [ -n "${previous_tag:-}" ]; then
    release_highlights="- Maintenance release: dependency, packaging, or operator-facing updates since \`${previous_tag}\`."
  else
    release_highlights="- First public release: bootstraps the CLI, desktop packaging, and verification flow."
  fi
fi

cat > "$output_path" <<NOTES
## Release Highlights

${release_highlights}

## Release Overview

- Version: \`${release_tag}\`
- Release date (UTC): ${release_date}
- Package source: GitHub Release assets

## Install / Upgrade

Pinned install:

\`\`\`bash
curl -fsSL ${install_script_url} | REDEVEN_VERSION=${release_tag} sh
\`\`\`

Upgrade an existing runtime in place:

\`\`\`bash
curl -fsSL ${install_script_url} | REDEVEN_INSTALL_MODE=upgrade REDEVEN_VERSION=${release_tag} sh
\`\`\`

## Binary Assets

- \`redeven_linux_amd64.tar.gz\`
- \`redeven_linux_arm64.tar.gz\`
- \`redeven_darwin_amd64.tar.gz\`
- \`redeven_darwin_arm64.tar.gz\`
- \`Redeven-Desktop-${release_tag#v}-linux-x64.deb\`
- \`Redeven-Desktop-${release_tag#v}-linux-x64.rpm\`
- \`Redeven-Desktop-${release_tag#v}-linux-arm64.deb\`
- \`Redeven-Desktop-${release_tag#v}-linux-arm64.rpm\`
- \`Redeven-Desktop-${release_tag#v}-mac-x64.dmg\`
- \`Redeven-Desktop-${release_tag#v}-mac-arm64.dmg\`
- \`SHA256SUMS\` + \`SHA256SUMS.sig\` + \`SHA256SUMS.pem\`

## Verify Integrity (recommended)

\`\`\`bash
curl -fLO ${release_url}/download/${release_tag}/SHA256SUMS
curl -fLO ${release_url}/download/${release_tag}/SHA256SUMS.sig
curl -fLO ${release_url}/download/${release_tag}/SHA256SUMS.pem

cosign verify-blob \\
  --certificate SHA256SUMS.pem \\
  --signature SHA256SUMS.sig \\
  --certificate-identity-regexp '^https://github.com/floegence/redeven/.github/workflows/release\.yml@refs/tags/v.*$' \\
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \\
  SHA256SUMS

sha256sum -c SHA256SUMS
\`\`\`

## Notes For Operators

- This public repository defines the GitHub Release contract and verification flow only.
- If you need installation details, see \`docs/RELEASE.md\` in this repository.
${compare_line}

---

## Auto-generated change list

The section below is generated by GitHub from merged pull requests and commits.
NOTES

printf '%s\n' "release notes written to $output_path"
