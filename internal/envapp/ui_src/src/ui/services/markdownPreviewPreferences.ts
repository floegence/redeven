import { createSignal } from 'solid-js';

import { readUIStorageJSON, writeUIStorageJSON } from './uiStorage';

export const MARKDOWN_PREVIEW_TEXT_SCALE_STORAGE_KEY = 'markdown-preview:text-scale-percent';
export const DEFAULT_MARKDOWN_PREVIEW_TEXT_SCALE_PERCENT = 100;
export const MIN_MARKDOWN_PREVIEW_TEXT_SCALE_PERCENT = 50;
export const MAX_MARKDOWN_PREVIEW_TEXT_SCALE_PERCENT = 160;
export const MARKDOWN_PREVIEW_TEXT_SCALE_STEP_PERCENT = 10;

let initialized = false;

const [textScalePercent, setTextScalePercentSignal] = createSignal(
  DEFAULT_MARKDOWN_PREVIEW_TEXT_SCALE_PERCENT,
);

export function normalizeMarkdownPreviewTextScalePercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MARKDOWN_PREVIEW_TEXT_SCALE_PERCENT;
  }

  const aligned = Math.round(value / MARKDOWN_PREVIEW_TEXT_SCALE_STEP_PERCENT)
    * MARKDOWN_PREVIEW_TEXT_SCALE_STEP_PERCENT;
  return Math.min(
    MAX_MARKDOWN_PREVIEW_TEXT_SCALE_PERCENT,
    Math.max(MIN_MARKDOWN_PREVIEW_TEXT_SCALE_PERCENT, aligned),
  );
}

function ensureMarkdownPreviewPreferencesInitialized(): void {
  if (initialized) return;
  initialized = true;
  setTextScalePercentSignal(normalizeMarkdownPreviewTextScalePercent(
    readUIStorageJSON<unknown>(
      MARKDOWN_PREVIEW_TEXT_SCALE_STORAGE_KEY,
      DEFAULT_MARKDOWN_PREVIEW_TEXT_SCALE_PERCENT,
    ),
  ));
}

export function useMarkdownPreviewPreferences() {
  ensureMarkdownPreviewPreferencesInitialized();

  const setTextScalePercent = (value: number): void => {
    const next = normalizeMarkdownPreviewTextScalePercent(value);
    if (next === textScalePercent()) return;
    setTextScalePercentSignal(next);
    writeUIStorageJSON(MARKDOWN_PREVIEW_TEXT_SCALE_STORAGE_KEY, next);
  };

  return {
    textScalePercent,
    setTextScalePercent,
  };
}
