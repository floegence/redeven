import { describe, expect, it } from 'vitest';

import {
  accessModeVisual,
  compactAddConnectionLabel,
  compactCloseActionLabel,
  compactOpenLocalEnvironmentLabel,
  compactPasswordStateTagLabel,
  compactSaveActionLabel,
  compactSettingsFieldLabel,
  describeNextStartAddress,
  describeRuntimeAddress,
  isRedundantSettingsFieldLabel,
  compactSettingsActionLabel,
  passwordStateVisualTone,
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
    expect(compactAddConnectionLabel()).toBe('Add');
    expect(compactSaveActionLabel()).toBe('Save');
  });

  it('detects redundant field labels inside matching settings cards', () => {
    expect(isRedundantSettingsFieldLabel('Local UI bind address', 'Bind address')).toBe(true);
    expect(isRedundantSettingsFieldLabel('Local UI password', 'Password')).toBe(true);
    expect(isRedundantSettingsFieldLabel('Control Plane URL', 'Advanced')).toBe(false);
    expect(isRedundantSettingsFieldLabel('Release Base URL')).toBe(false);
  });

  it('shortens verbose tag copy while preserving meaning', () => {
    expect(compactPasswordStateTagLabel('Password configured')).toBe('Password set');
    expect(compactPasswordStateTagLabel('Password required before the next open of Local Environment')).toBe('Password needed');
    expect(compactPasswordStateTagLabel('Password will be replaced on save')).toBe('Update on save');
  });

  it('converts field help HTML into compact plain text for tooltips', () => {
    expect(plainTextFromHelpHTML('Examples: <code>localhost:23998</code>, <code>127.0.0.1:0</code>.')).toBe(
      'Examples: localhost:23998, 127.0.0.1:0.',
    );
  });

  it('maps access modes to a compact visual descriptor for tags', () => {
    expect(accessModeVisual('local_only')).toEqual({
      short_label: 'Local',
      tone: 'neutral',
      description: 'Only this machine',
    });
    expect(accessModeVisual('shared_local_network')).toEqual({
      short_label: 'LAN',
      tone: 'primary',
      description: 'Shared on your local network',
    });
    expect(accessModeVisual('custom_exposure')).toEqual({
      short_label: 'Custom',
      tone: 'warning',
      description: 'Custom bind and password',
    });
  });

  it('maps password state tones to tag visual tones', () => {
    expect(passwordStateVisualTone('success')).toBe('success');
    expect(passwordStateVisualTone('warning')).toBe('warning');
    expect(passwordStateVisualTone('default')).toBe('neutral');
  });

  it('splits human-readable next-start address values into renderable parts', () => {
    expect(describeNextStartAddress('localhost:23998')).toEqual({
      primary: 'localhost:23998',
      primary_monospace: true,
      hint: '',
    });
    expect(describeNextStartAddress('0.0.0.0:24000')).toEqual({
      primary: '0.0.0.0:24000',
      primary_monospace: true,
      hint: '',
    });
    expect(describeNextStartAddress('Your device IP:24000')).toEqual({
      primary: 'Port 24000',
      primary_monospace: false,
      hint: 'on your LAN IP',
    });
    expect(describeNextStartAddress('Auto-select on localhost')).toEqual({
      primary: 'Auto port',
      primary_monospace: false,
      hint: 'on localhost',
    });
    expect(describeNextStartAddress('')).toEqual({
      primary: '',
      primary_monospace: false,
      hint: '',
    });
  });

  it('describes runtime URLs with monospace fonts when they look address-like', () => {
    expect(describeRuntimeAddress('http://localhost:23998/')).toEqual({
      primary: 'http://localhost:23998/',
      primary_monospace: true,
      hint: '',
    });
    expect(describeRuntimeAddress('')).toEqual({
      primary: 'Not running',
      primary_monospace: false,
      hint: '',
    });
    expect(describeRuntimeAddress('Not currently running')).toEqual({
      primary: 'Not currently running',
      primary_monospace: false,
      hint: '',
    });
  });
});
