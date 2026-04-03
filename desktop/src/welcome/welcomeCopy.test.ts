import { describe, expect, it } from 'vitest';

import {
  compactAddConnectionLabel,
  compactBootstrapStatusTagLabel,
  compactClearRequestLabel,
  compactCloseActionLabel,
  compactOpenLocalEnvironmentLabel,
  compactPasswordStateTagLabel,
  compactSaveActionLabel,
  compactSettingsFieldLabel,
  isRedundantSettingsFieldLabel,
  compactSettingsActionLabel,
  plainTextFromHelpHTML,
} from './welcomeCopy';

describe('welcomeCopy', () => {
  it('shortens the dense desktop button labels', () => {
    expect(compactCloseActionLabel('Close Launcher')).toBe('Close Launcher');
    expect(compactCloseActionLabel('Quit')).toBe('Quit');
    expect(compactOpenLocalEnvironmentLabel(false)).toBe('Open');
    expect(compactOpenLocalEnvironmentLabel(true)).toBe('Focus');
    expect(compactSettingsActionLabel()).toBe('Settings');
    expect(compactSettingsFieldLabel('Local UI bind address')).toBe('Bind address');
    expect(compactSettingsFieldLabel('Local UI password')).toBe('Password');
    expect(compactSettingsFieldLabel('Control plane URL')).toBe('Control plane');
    expect(compactSettingsFieldLabel('Environment ID')).toBe('Env ID');
    expect(compactSettingsFieldLabel('Environment token')).toBe('Env token');
    expect(compactAddConnectionLabel()).toBe('Add');
    expect(compactSaveActionLabel()).toBe('Save');
    expect(compactClearRequestLabel()).toBe('Clear request');
  });

  it('detects redundant field labels inside matching settings cards', () => {
    expect(isRedundantSettingsFieldLabel('Local UI bind address', 'Bind address')).toBe(true);
    expect(isRedundantSettingsFieldLabel('Local UI password', 'Password')).toBe(true);
    expect(isRedundantSettingsFieldLabel('Control plane URL', 'Advanced')).toBe(false);
    expect(isRedundantSettingsFieldLabel('Environment token')).toBe(false);
  });

  it('shortens verbose tag copy while preserving meaning', () => {
    expect(compactPasswordStateTagLabel('Password configured')).toBe('Password set');
    expect(compactPasswordStateTagLabel('Password required before the next open of Local Environment')).toBe('Password needed');
    expect(compactPasswordStateTagLabel('Password will be replaced on save')).toBe('Update on save');
    expect(compactBootstrapStatusTagLabel('Registration queued for next start')).toBe('Queued');
    expect(compactBootstrapStatusTagLabel('No bootstrap request queued')).toBe('No request');
  });

  it('converts field help HTML into compact plain text for tooltips', () => {
    expect(plainTextFromHelpHTML('Examples: <code>localhost:23998</code>, <code>127.0.0.1:0</code>.')).toBe(
      'Examples: localhost:23998, 127.0.0.1:0.',
    );
  });
});
