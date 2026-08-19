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
    /bundle_from_source "\$goos" "\$goarch" "\$working_bundle_path" "\$working_gateway_path" "\$bundle_version" "\$bundle_commit"/u,
  );
  assert.doesNotMatch(source, /REDEVEN_DESKTOP_VERSION:-0\.0\.0-dev/u);
});
