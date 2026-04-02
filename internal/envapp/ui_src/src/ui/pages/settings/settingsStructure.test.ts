// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  SETTINGS_GROUPS,
  SETTINGS_NAV_ITEMS,
  SETTINGS_SECTION_META,
  SETTINGS_SECTIONS,
  settingsGroupForSection,
} from './settingsStructure';

describe('settingsStructure', () => {
  it('defines the expected top-level group order', () => {
    expect(SETTINGS_GROUPS.map((group) => group.title)).toEqual([
      'Overview',
      'Runtime Configuration',
      'Codespaces & Tooling',
      'Security',
      'AI & Extensions',
      'Diagnostics',
    ]);
  });

  it('assigns every settings section exactly once', () => {
    const groupSections = SETTINGS_GROUPS.flatMap((group) => group.sections);
    const uniqueSections = new Set(groupSections);

    expect(groupSections.length).toBe(SETTINGS_SECTIONS.length);
    expect(uniqueSections.size).toBe(SETTINGS_SECTIONS.length);
    expect(Array.from(uniqueSections).sort()).toEqual(Object.keys(SETTINGS_SECTION_META).sort());
  });

  it('keeps navigation labels unique and aligned with section order', () => {
    const labels = SETTINGS_NAV_ITEMS.map((item) => item.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(SETTINGS_NAV_ITEMS.map((item) => item.id)).toEqual(SETTINGS_SECTIONS.map((item) => item.id));
    expect(SETTINGS_GROUPS.find((group) => group.id === 'ai_extensions')?.sections).toEqual(['ai', 'skills', 'codex']);
  });

  it('maps key sections into the expected groups', () => {
    expect(settingsGroupForSection('agent').id).toBe('overview');
    expect(settingsGroupForSection('runtime').id).toBe('runtime_configuration');
    expect(settingsGroupForSection('codespaces').id).toBe('codespaces_tooling');
    expect(settingsGroupForSection('permission_policy').id).toBe('security');
    expect(settingsGroupForSection('ai').id).toBe('ai_extensions');
    expect(settingsGroupForSection('skills').id).toBe('ai_extensions');
    expect(settingsGroupForSection('codex').id).toBe('ai_extensions');
    expect(settingsGroupForSection('debug_console').id).toBe('diagnostics');
  });
});
