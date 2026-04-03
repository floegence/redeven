import { describe, expect, it } from 'vitest';

import {
  compactAddConnectionLabel,
  compactBootstrapStatusTagLabel,
  compactClearRequestLabel,
  compactCloseActionLabel,
  compactOpenLocalEnvironmentLabel,
  compactPasswordStateTagLabel,
  compactSaveActionLabel,
  compactSessionAvailabilityLabel,
  compactSettingsActionLabel,
} from './welcomeCopy';

describe('welcomeCopy', () => {
  it('shortens the dense desktop button labels', () => {
    expect(compactCloseActionLabel('Back to current environment')).toBe('Back');
    expect(compactCloseActionLabel('Quit')).toBe('Quit');
    expect(compactOpenLocalEnvironmentLabel(false)).toBe('Open');
    expect(compactOpenLocalEnvironmentLabel(true)).toBe('Resume');
    expect(compactSettingsActionLabel()).toBe('Settings');
    expect(compactAddConnectionLabel()).toBe('Add');
    expect(compactSaveActionLabel()).toBe('Save');
    expect(compactClearRequestLabel()).toBe('Clear request');
  });

  it('shortens verbose tag copy while preserving meaning', () => {
    expect(compactSessionAvailabilityLabel()).toBe('Active');
    expect(compactPasswordStateTagLabel('Password configured')).toBe('Password set');
    expect(compactPasswordStateTagLabel('Password required before the next open of Local Environment')).toBe('Password needed');
    expect(compactPasswordStateTagLabel('Password will be replaced on save')).toBe('Update on save');
    expect(compactBootstrapStatusTagLabel('Registration queued for next start')).toBe('Queued');
    expect(compactBootstrapStatusTagLabel('No bootstrap request queued')).toBe('No request');
  });
});
