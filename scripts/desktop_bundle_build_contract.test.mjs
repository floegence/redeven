import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./build_desktop_bundled_runtime.sh', import.meta.url), 'utf8');

test('Desktop bundle binaries and manifest share the Desktop package identity', () => {
  assert.match(source, /resolve_bundle_version\(\)/u);
  assert.match(source, /require\(process\.argv\[1\]\)\.version/u);
  assert.match(source, /bundle_version="\$\(resolve_bundle_version\)"/u);
  assert.match(
    source,
    /bundle_from_source "\$goos" "\$goarch" "\$working_bundle_path" "\$bundle_version" "\$bundle_commit"/u,
  );
  assert.doesNotMatch(source, /REDEVEN_DESKTOP_GATEWAY_TARBALL/u);
  assert.doesNotMatch(source, /REDEVEN_DESKTOP_VERSION:-0\.0\.0-dev/u);
});

test('Windows Desktop validates and preserves one exact Linux x64 managed WSL archive', () => {
  assert.match(source, /assert_tarball_target "\$tarball_path" linux amd64 "Redeven managed WSL runtime archive"/u);
  assert.match(source, /bundle_from_tarball "\$tarball_path" "\$inspection_bundle" linux/u);
  assert.match(source, /assert_go_binary_target "\$inspection_bundle\/redeven" linux amd64/u);
  assert.match(source, /assert_go_binary_build_identity "\$inspection_bundle\/redeven" "\$bundle_version" "\$bundle_commit"/u);
  assert.match(source, /cp "\$tarball_path" "\$working_bundle_path"/u);
  assert.match(source, /managed_wsl_runtime: managedWSLArchive \? \{/u);
  assert.match(source, /platform: "linux"/u);
  assert.match(source, /architecture: "amd64"/u);
  assert.match(source, /archive_files: managedWSLArchiveFiles/u);
});
