import { describe, expect, it } from 'vitest';

import { normalizeDesktopArtifactName } from './artifactNames';

describe('normalizeDesktopArtifactName', () => {
  it('renames linux amd64 AppImage artifacts to x64', () => {
    expect(normalizeDesktopArtifactName('Redeven-Desktop-0.4.3-linux-x86_64.AppImage')).toBe(
      'Redeven-Desktop-0.4.3-linux-x64.AppImage',
    );
  });

  it('keeps linux arm64 AppImage artifacts unchanged', () => {
    expect(normalizeDesktopArtifactName('Redeven-Desktop-0.4.3-linux-arm64.AppImage')).toBe(
      'Redeven-Desktop-0.4.3-linux-arm64.AppImage',
    );
  });

  it('keeps mac dmg artifacts unchanged', () => {
    expect(normalizeDesktopArtifactName('Redeven-Desktop-0.4.3-mac-x64.dmg')).toBe(
      'Redeven-Desktop-0.4.3-mac-x64.dmg',
    );
  });
});
