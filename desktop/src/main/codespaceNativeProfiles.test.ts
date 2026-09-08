import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it, expect } from 'vitest';
import {
  NativeCodeSpaceProfiles,
  nativeCodeSpaceIdentity,
} from './codespaceNativeProfiles';
import { buildManagedLocalRuntimeDesktopTarget } from './desktopTarget';
it('preserves exact origins across restarts and rejects invalid state read-only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-native-profile-'));
  const file = path.join(dir, 'profiles.json');
  try {
    const id = nativeCodeSpaceIdentity(
      buildManagedLocalRuntimeDesktopTarget('one', 'One'),
      'space',
    );
    const store = new NativeCodeSpaceProfiles(file);
    store.remember(id, 43567);
    expect(new NativeCodeSpaceProfiles(file).port(id)).toBe(43567);
    expect(() => store.remember(id, 43568)).toThrow(
      'codespace_origin_conflict',
    );
    expect(
      nativeCodeSpaceIdentity(
        buildManagedLocalRuntimeDesktopTarget('two', 'Two'),
        'space',
      ),
    ).not.toBe(id);
    for (const bytes of [
      'broken',
      '{"version":2,"ports":{}}',
      `{"version":1,"ports":{"${id}":0}}`,
    ]) {
      fs.writeFileSync(file, bytes);
      expect(() => new NativeCodeSpaceProfiles(file)).toThrow(
        'codespace_profiles_invalid',
      );
      expect(fs.readFileSync(file, 'utf8')).toBe(bytes);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
