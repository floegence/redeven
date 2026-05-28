import { describe, expect, it } from 'vitest';

import { normalizeDesktopLanguageSnapshot } from './desktopLanguageIPC';

describe('normalizeDesktopLanguageSnapshot', () => {
  it('accepts language snapshots with a supported explicit locale', () => {
    expect(normalizeDesktopLanguageSnapshot({
      preference: 'zh-CN',
      resolved_locale: 'zh-CN',
      source: 'explicit',
      system_candidates: ['en-US', 'zh-Hans', 'en-US'],
    })).toEqual({
      preference: 'zh-CN',
      resolved_locale: 'zh-CN',
      source: 'explicit',
      system_candidates: ['en-US', 'zh-Hans'],
    });
  });

  it('accepts system snapshots resolved by the main process', () => {
    expect(normalizeDesktopLanguageSnapshot({
      preference: 'system',
      resolved_locale: 'pt-BR',
      source: 'system',
      system_candidates: ['pt-PT'],
    })).toEqual({
      preference: 'system',
      resolved_locale: 'pt-BR',
      source: 'system',
      system_candidates: ['pt-PT'],
    });
  });

  it('rejects malformed snapshots', () => {
    expect(normalizeDesktopLanguageSnapshot({
      preference: 'zh-CN',
      resolved_locale: 'en-US',
      source: 'explicit',
      system_candidates: ['zh-CN'],
    })).toBeNull();
    expect(normalizeDesktopLanguageSnapshot({
      preference: 'system',
      resolved_locale: 'nl-NL',
      source: 'system',
      system_candidates: ['nl-NL'],
    })).toBeNull();
    expect(normalizeDesktopLanguageSnapshot({
      preference: 'zh-CN',
      resolved_locale: 'pt-BR',
      source: 'system',
      system_candidates: ['pt-PT'],
    })).toBeNull();
    expect(normalizeDesktopLanguageSnapshot({
      preference: 'fr-FR',
      resolved_locale: 'en-US',
      source: 'fallback',
      system_candidates: [],
    })).toBeNull();
  });
});
