import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadPreferences(persistedValue: unknown = 100) {
  vi.resetModules();
  const readUIStorageJSON = vi.fn(() => persistedValue);
  const writeUIStorageJSON = vi.fn();
  vi.doMock('./uiStorage', () => ({
    readUIStorageJSON,
    writeUIStorageJSON,
  }));

  const preferences = await import('./markdownPreviewPreferences');
  return { preferences, readUIStorageJSON, writeUIStorageJSON };
}

afterEach(() => {
  vi.doUnmock('./uiStorage');
  vi.resetModules();
  vi.clearAllMocks();
});

describe('markdownPreviewPreferences', () => {
  it('loads, aligns, and shares one persisted text scale across preview consumers', async () => {
    const {
      preferences,
      readUIStorageJSON,
      writeUIStorageJSON,
    } = await loadPreferences(126);

    const first = preferences.useMarkdownPreviewPreferences();
    const second = preferences.useMarkdownPreviewPreferences();

    expect(first.textScalePercent()).toBe(130);
    expect(second.textScalePercent()).toBe(130);
    expect(readUIStorageJSON).toHaveBeenCalledTimes(1);
    expect(writeUIStorageJSON).not.toHaveBeenCalled();

    first.setTextScalePercent(140);

    expect(first.textScalePercent()).toBe(140);
    expect(second.textScalePercent()).toBe(140);
    expect(writeUIStorageJSON).toHaveBeenCalledWith(
      preferences.MARKDOWN_PREVIEW_TEXT_SCALE_STORAGE_KEY,
      140,
    );
  });

  it('falls back for malformed values and clamps finite values to the supported range', async () => {
    const { preferences } = await loadPreferences('120');
    const value = preferences.useMarkdownPreviewPreferences();

    expect(value.textScalePercent()).toBe(
      preferences.DEFAULT_MARKDOWN_PREVIEW_TEXT_SCALE_PERCENT,
    );
    expect(preferences.normalizeMarkdownPreviewTextScalePercent(Number.NaN)).toBe(100);
    expect(preferences.normalizeMarkdownPreviewTextScalePercent(74)).toBe(80);
    expect(preferences.normalizeMarkdownPreviewTextScalePercent(166)).toBe(160);
    expect(preferences.normalizeMarkdownPreviewTextScalePercent(114)).toBe(110);
    expect(preferences.normalizeMarkdownPreviewTextScalePercent(115)).toBe(120);
  });

  it('writes a changed normalized value immediately and skips no-op writes', async () => {
    const { preferences, writeUIStorageJSON } = await loadPreferences(100);
    const value = preferences.useMarkdownPreviewPreferences();

    value.setTextScalePercent(104);
    expect(writeUIStorageJSON).not.toHaveBeenCalled();

    value.setTextScalePercent(146);
    expect(value.textScalePercent()).toBe(150);
    expect(writeUIStorageJSON).toHaveBeenCalledTimes(1);
    expect(writeUIStorageJSON).toHaveBeenLastCalledWith(
      preferences.MARKDOWN_PREVIEW_TEXT_SCALE_STORAGE_KEY,
      150,
    );
  });
});
