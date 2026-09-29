import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/ci-check.yml", import.meta.url), "utf8");
const codeqlWorkflow = readFileSync(new URL("../.github/workflows/codeql.yml", import.meta.url), "utf8");
const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const desktopBuilderConfig = readFileSync(new URL("../desktop/electron-builder.config.mjs", import.meta.url), "utf8");
const redevpluginRuntimeStage = readFileSync(new URL("./stage_redevplugin_release_artifacts.sh", import.meta.url), "utf8");
const sparkleReleaseScript = readFileSync(new URL("./generate_desktop_sparkle_appcast.sh", import.meta.url), "utf8");
const macPackageVerifier = readFileSync(new URL("./verify_macos_desktop_update_package.sh", import.meta.url), "utf8");
const quickGate = readFileSync(new URL("./check_quick_ci.sh", import.meta.url), "utf8");
const finalGate = readFileSync(new URL("./check_final_integration.sh", import.meta.url), "utf8");
const uiGate = readFileSync(new URL("./check_ui_tests.sh", import.meta.url), "utf8");
const flowerGate = readFileSync(new URL("./check_flower_ui.sh", import.meta.url), "utf8");
const jobsSource = workflow.slice(workflow.indexOf("\njobs:\n") + "\njobs:\n".length);
const releaseJobsSource = releaseWorkflow.slice(releaseWorkflow.indexOf("\njobs:\n") + "\njobs:\n".length);

const allowedQuickGateCommands = new Set([
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  'SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)',
  'ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)',
  'cd "$ROOT_DIR"',
  'echo "[INFO] checking repository diff and Go formatting"',
  "git diff --check",
  "git diff-tree --check --root -r --no-commit-id HEAD",
  'test -z "$(gofmt -l $(git ls-files \'*.go\'))"',
  'echo "[INFO] checking shell, JavaScript, and Python syntax"',
  "for script in scripts/*.sh scripts/okf/*.sh .githooks/pre-commit .githooks/pre-push; do",
  'bash -n "$script"',
  "done",
  "for script in scripts/*.mjs; do",
  'node --check "$script"',
  'python3 -c \'from pathlib import Path; [compile(Path(name).read_text(encoding="utf-8"), name, "exec") for name in ("scripts/safe_extract_tar.py", "scripts/extract_desktop_runtime.py")]\'',
  'echo "[INFO] checking bounded cloud policy and committed knowledge artifacts"',
  "node --test scripts/quick_ci_policy.test.mjs scripts/actionlint_runner_policy.test.mjs scripts/check_go_version_consistency.test.mjs scripts/floeterm_native_build_contract.test.mjs scripts/node_toolchain_contract.test.mjs",
  "node --test scripts/check_floeterm_dependency_consistency.test.mjs",
  "node --test scripts/computer_webtop_cleanup.test.mjs scripts/computer_webtop_acceptance.test.mjs scripts/qualification_response_stream.test.mjs",
  "node scripts/check_floeterm_dependency_consistency.mjs",
  "./scripts/ui_package_common_node_test.sh",
  "node scripts/check_go_version_consistency.mjs",
  "node scripts/check_managed_service_catalog_boundary.mjs",
  "python3 scripts/check_flower_storage_compatibility.py",
  "python3 scripts/model-catalog/test_generate.py",
  "python3 scripts/model-catalog/generate.py --check",
  "node --test scripts/check_readme_localizations.test.mjs",
  "node scripts/check_readme_localizations.mjs",
  "./scripts/okf/check_source_integrity.sh",
  "./scripts/build_okf_bundle.sh --verify-only",
  'echo "[INFO] quick CI passed"',
]);

function assertClosedQuickGate(source) {
  const commands = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  for (const command of commands) {
    assert.ok(allowedQuickGateCommands.has(command), `unexpected quick gate command: ${command}`);
  }
}

test("ordinary GitHub CI is one bounded source-only job", () => {
  assert.match(workflow, /^name: Quick CI$/m);
  assert.match(workflow, /^\s{4}name: Quick CI$/m);
  assert.match(workflow, /^\s{4}timeout-minutes: 5$/m);
  assert.match(workflow, /\.\/scripts\/check_quick_ci\.sh/);
  assert.deepEqual(
    [...jobsSource.matchAll(/^  ([a-z][a-z0-9-]*):$/gm)].map((match) => match[1]),
    ["quick-ci"],
  );
  assert.deepEqual(
    [...workflow.matchAll(/^\s+run: (.+)$/gm)].map((match) => match[1]),
    ["./scripts/check_quick_ci.sh"],
  );

  for (const forbidden of [
    "check_final_integration",
    "playwright",
    "chromium",
    "electron-builder",
    "go test",
    "pnpm install",
    "npm ci",
    "built-dist",
    "terminal-carrier",
    "check_flower_ui",
    "check_desktop",
    "docker",
  ]) {
    assert.doesNotMatch(workflow, new RegExp(forbidden, "i"));
  }
});

test("CodeQL scans changed main daily without joining push or pull request CI", () => {
  assert.match(codeqlWorkflow, /^name: CodeQL$/m);
  assert.match(codeqlWorkflow, /^  workflow_dispatch: \{\}$/m);
  assert.match(codeqlWorkflow, /^  schedule:$/m);
  assert.match(codeqlWorkflow, /^    - cron: "17 3 \* \* \*"$/m);
  assert.doesNotMatch(codeqlWorkflow, /^  (?:push|pull_request):/m);
  assert.match(codeqlWorkflow, /event=schedule&status=success&per_page=1/);
  assert.match(codeqlWorkflow, /previous_sha.*HEAD_SHA/s);
  assert.match(codeqlWorkflow, /should_scan=false/);
  assert.match(codeqlWorkflow, /Could not inspect previous CodeQL runs; scanning fail-safe/);
  assert.match(codeqlWorkflow, /if: needs\.plan\.outputs\.should_scan == 'true'/);
  assert.deepEqual(
    [...codeqlWorkflow.matchAll(/^          - language: (.+)$/gm)].map((match) => match[1]),
    ["actions", "go", "javascript-typescript", "python"],
  );
});

test("quick gate checks the committed tree instead of trusting a clean checkout", () => {
  assert.match(quickGate, /git diff-tree --check --root -r --no-commit-id HEAD/);
});

test("exact-main gate enforces the cloud Go formatting contract", () => {
  assert.match(finalGate, /unformatted="\$\(gofmt -l \$\(git ls-files '\*\.go'\)\)"/);
  assert.match(finalGate, /run_step "checking Go formatting" check_go_formatting/);
});

test("README localization gates enforce synchronization without reviewer flags", () => {
  assert.match(quickGate, /^node scripts\/check_readme_localizations\.mjs$/m);
  assert.match(
    finalGate,
    /run_step "checking synchronized README localizations" node scripts\/check_readme_localizations\.mjs/,
  );
  assert.doesNotMatch(`${quickGate}\n${finalGate}`, /--require-reviewed/);
});

test("quick gate remains a closed source-only command set", () => {
  assertClosedQuickGate(quickGate);

  for (const forbidden of [
    "playwright",
    "chromium",
    "vitest",
    "go test",
    "pnpm",
    "npm ci",
    "terminal-carrier",
    "terminal-performance",
    "check_final_integration",
    "check_ui_tests",
    "check_renderer_e2e",
    "check_flower_ui",
    "check_desktop",
    "docker",
  ]) {
    assert.doesNotMatch(quickGate, new RegExp(forbidden, "i"));
  }
});

test("quick gate cannot hide work after a logging command", () => {
  const mutatedGate = quickGate.replace(
    'echo "[INFO] quick CI passed"',
    'echo "[INFO] quick CI passed"; ./scripts/check_plugin_integration.sh --ci',
  );
  assert.throws(
    () => assertClosedQuickGate(mutatedGate),
    /unexpected quick gate command: .*check_plugin_integration/,
  );
});

test("exact-main pre-push remains bounded and delegates broad qualification", () => {
  assert.match(finalGate, /check_focused_changed_tests/);
  for (const forbidden of [
    "test:browser",
    "test:terminal-performance",
    "go test -tags floeterm_native -p 1 -count=1 ./...",
    "golangci-lint run --build-tags floeterm_native ./...",
  ]) {
    assert.doesNotMatch(finalGate, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.doesNotMatch(finalGate, /run_step "[^"]+" .*check_ui_tests\.sh/u);
  assert.doesNotMatch(finalGate, /run_step "[^"]+" .*check_flower_ui\.sh/u);
  assert.doesNotMatch(finalGate, /run_step "[^"]+" .*check_desktop\.sh/u);
  assert.doesNotMatch(finalGate, /run_step "[^"]+" .*check_computer_(?:execution|private_desktop)\.sh/u);
  assert.doesNotMatch(finalGate, /run_step "[^"]+" .*check_docker_runtime_e2e\.sh/u);
  assert.doesNotMatch(finalGate, /run_step "[^"]+" .*check_renderer_e2e\.sh/u);
});

test("Flower UI gate provisions Node 26 webstorage backing without discarding caller options", () => {
  assert.match(flowerGate, /case " \$\{NODE_OPTIONS:-\} "/);
  assert.match(flowerGate, /--localstorage-file=/);
  assert.match(flowerGate, /mktemp .*redeven-flower-localstorage/);
  assert.match(flowerGate, /export NODE_OPTIONS="\$\{NODE_OPTIONS:\+\$NODE_OPTIONS \}--localstorage-file=/);
  assert.match(flowerGate, /trap 'rm -f -- "\$flower_localstorage_file" "\$flower_localstorage_file-wal" "\$flower_localstorage_file-shm"'/);
  assert.doesNotMatch(flowerGate, /--no-experimental-webstorage/);
});

test("complete UI gate provisions Node 26 webstorage backing without discarding caller options", () => {
  assert.match(uiGate, /case " \$\{NODE_OPTIONS:-\} "/);
  assert.match(uiGate, /--localstorage-file=/);
  assert.match(uiGate, /mktemp .*redeven-ui-localstorage/);
  assert.match(uiGate, /export NODE_OPTIONS="\$\{NODE_OPTIONS:\+\$NODE_OPTIONS \}--localstorage-file=/);
  assert.match(uiGate, /trap 'rm -f -- "\$ui_localstorage_file" "\$ui_localstorage_file-wal" "\$ui_localstorage_file-shm"'/);
  assert.doesNotMatch(uiGate, /--no-experimental-webstorage/);
});

test("release workflow validates exact main and contains no test gate", () => {
  assert.match(releaseWorkflow, /^  release-ref:$/m);
  assert.match(releaseWorkflow, /refs\/remotes\/origin\/main/);
  assert.match(releaseWorkflow, /tagged_commit.*main_commit/s);
  assert.match(releaseWorkflow, /tagged_commit.*GITHUB_SHA/s);
  assert.equal(
    [...releaseJobsSource.matchAll(/^  ([a-z][a-z0-9-]*):$/gm)].length,
    [...releaseJobsSource.matchAll(/^    timeout-minutes: [0-9]+$/gm)].length,
  );
  const desktopInstallOffset = releaseWorkflow.indexOf("run: npm ci --no-audit --no-fund");
  const desktopPackageOffset = releaseWorkflow.indexOf("npm run package --");
  assert.ok(desktopInstallOffset > 0, "release must install Desktop build dependencies");
  assert.ok(desktopPackageOffset > desktopInstallOffset, "release must install Desktop dependencies before packaging");

  for (const forbidden of [
    "renderer-e2e",
    "playwright",
    "chromium",
    "go test",
    "pnpm run test",
    "check_desktop.sh",
    "check_gateway_protocol_contract.sh",
  ]) {
    assert.doesNotMatch(releaseWorkflow, new RegExp(forbidden, "i"));
  }
});

test("release workflow keeps Desktop update credentials in the protected environment", () => {
  assert.match(releaseWorkflow, /environment: redeven-release/u);
  assert.match(releaseWorkflow, /REDEVEN_SPARKLE_PRIVATE_KEY: \$\{\{ secrets\.REDEVEN_SPARKLE_PRIVATE_KEY \}\}/u);
  assert.match(releaseWorkflow, /REDEVEN_SPARKLE_PUBLIC_ED_KEY: \$\{\{ secrets\.REDEVEN_SPARKLE_PUBLIC_ED_KEY \}\}/u);
  assert.match(releaseWorkflow, /https:\/\/github\.com\/\$\{\{ github\.repository \}\}\/releases\/latest\/download/u);
  assert.match(releaseWorkflow, /generate_desktop_sparkle_appcast\.sh/u);
  assert.match(sparkleReleaseScript, /--maximum-deltas 0/u);
  assert.match(releaseWorkflow, /if: \$\{\{ !contains\(github\.ref_name, '-'\) \}\}/u);
  for (const forbidden of ['find-disk-killer', 'jianyintang', 'Y3A8BJ447', 'BEGIN PRIVATE KEY']) {
    assert.doesNotMatch(releaseWorkflow, new RegExp(forbidden, 'i'));
  }
});

test("each release job that consumes signed runtime artifacts installs cosign first", () => {
  for (const [job, consumer] of [
    ['build', 'Build signed ReDevPlugin runtime and package archives'],
    ['desktop', 'Build desktop package'],
    ['release', 'Validate ReDevPlugin consumption gate'],
  ]) {
    const jobSource = releaseJobsSource.split(/(?=^  [a-z][a-z0-9-]*:$)/mu)
      .find((source) => source.startsWith(`  ${job}:\n`));
    assert.ok(jobSource, `missing release job: ${job}`);
    const installOffset = jobSource.indexOf('uses: sigstore/cosign-installer@');
    const consumeOffset = jobSource.indexOf(`- name: ${consumer}`);
    assert.ok(installOffset >= 0 && installOffset < consumeOffset, `${job} must install cosign before ${consumer}`);
  }
});

test("release workflow signs and preserves exact Darwin ReDevPlugin runtime bytes", () => {
  assert.match(releaseWorkflow, /apple-actions\/import-codesign-certs@[a-f0-9]{40} # v7/u);
  assert.match(releaseWorkflow, /REDEVEN_REDEVPLUGIN_RUNTIME_CODESIGN_IDENTITY: \$\{\{ secrets\.REDEVEN_DESKTOP_MAC_IDENTITY \}\}/u);
  assert.match(redevpluginRuntimeStage, /codesign --force --options runtime --timestamp --sign "\$codesign_identity" "\$runtime"/u);
  assert.match(redevpluginRuntimeStage, /verify-runtime-executable "\$runtime" "\$target"/u);
  assert.match(desktopBuilderConfig, /signIgnore: \['\*\*\/Contents\/Resources\/bin\/redevplugin-runtime'\]/u);
});

test("macOS release signs and notarizes the final disk image before package verification", () => {
  assert.match(desktopBuilderConfig, /dmg: \{\s+sign: true,/u);
  const packageOffset = releaseWorkflow.indexOf('- name: Build desktop package');
  const notarizeOffset = releaseWorkflow.indexOf('- name: Notarize macOS disk image');
  const verifyOffset = releaseWorkflow.indexOf('- name: Verify packaged ReDevPlugin runtime');
  assert.ok(notarizeOffset > packageOffset && notarizeOffset < verifyOffset);
  const notarizeStep = releaseWorkflow.slice(notarizeOffset, releaseWorkflow.indexOf('\n      - name:', notarizeOffset));
  assert.match(notarizeStep, /notarytool submit "\$dmg"/u);
  assert.match(notarizeStep, /--wait --timeout 20m --output-format json/u);
  assert.match(notarizeStep, /Accepted/u);
  assert.match(notarizeStep, /stapler staple "\$dmg"/u);
  assert.match(notarizeStep, /stapler validate "\$dmg"/u);
  assert.match(macPackageVerifier, /codesign --verify --strict --verbose=2 "\$dmg"/u);
  assert.match(macPackageVerifier, /syspolicy_check distribution "\$app_bundle"/u);
  assert.doesNotMatch(macPackageVerifier, /spctl --assess/u);
});

for (const arch of ['amd64', 'arm64']) {
  for (const [status, commandExit, expectedExit] of [['Accepted', 0, 0], ['Invalid', 0, 1], ['In Progress', 124, 124]]) {
    test(`macOS ${arch} disk image notarization handles ${status} before stapling`, () => {
      const root = mkdtempSync(join(tmpdir(), 'redeven-dmg-notary-'));
      try {
        const bin = join(root, 'bin');
        const record = join(root, 'commands');
        mkdirSync(bin);
        writeFileSync(join(bin, 'codesign'), '#!/bin/sh\nprintf "codesign %s\\n" "$*" >> "$FIXTURE_COMMANDS"\n', { mode: 0o755 });
        writeFileSync(join(bin, 'xcrun'), `#!/bin/sh
printf 'xcrun %s\\n' "$*" >> "$FIXTURE_COMMANDS"
if [ "$1" = notarytool ]; then
  printf '{"status":"%s"}\\n' "$FIXTURE_NOTARY_STATUS"
  exit "$FIXTURE_NOTARY_EXIT"
fi
`, { mode: 0o755 });
        const block = releaseWorkflow.match(/- name: Notarize macOS disk image[\s\S]*?        run: \|\n([\s\S]*?)(?=\n      - name:)/u)?.[1];
        assert.ok(block, 'missing disk image notarization command');
        const script = block.replace(/^          /gmu, '').replaceAll('${{ matrix.goarch }}', arch);
        const result = spawnSync('/bin/bash', ['-c', script], {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            GITHUB_REF_NAME: 'v0.13.2',
            RUNNER_TEMP: root,
            REDEVEN_DESKTOP_MAC_NOTARY_KEY_PATH: join(root, 'fixture key.p8'),
            APPLE_API_KEY_ID: 'fixture-key-id',
            APPLE_API_ISSUER: 'fixture-issuer',
            FIXTURE_COMMANDS: record,
            FIXTURE_NOTARY_STATUS: status,
            FIXTURE_NOTARY_EXIT: String(commandExit),
          },
        });
        assert.equal(result.status, expectedExit, result.stderr);
        const dmg = `desktop/release/Redeven-Desktop-0.13.2-mac-${arch === 'amd64' ? 'x64' : 'arm64'}.dmg`;
        const commands = readFileSync(record, 'utf8').trim().split('\n');
        assert.equal(commands[0], `codesign --verify --strict --verbose=2 ${dmg}`);
        assert.ok(commands[1].startsWith(`xcrun notarytool submit ${dmg} `));
        assert.deepEqual(commands.slice(2), expectedExit === 0 ? [
          `xcrun stapler staple ${dmg}`,
          `xcrun stapler validate ${dmg}`,
        ] : []);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
}
