import { describe, expect, it } from 'vitest';

import { normalizeMarkdownForDisplay } from './normalizeMarkdownForDisplay';

describe('normalizeMarkdownForDisplay', () => {
  it('repairs glued chapter headings from malformed transcript content', () => {
    const input = [
      '# 🌟星光森林的秘密##第一章：莉莉的发现在遥远的北方，有一片被繁星眷顾的神秘森林。',
      '',
      '##第二章：穿越荆棘沼泽按照古树长老的指引，莉莉首先要穿越荆棘沼泽。',
    ].join('\n');

    expect(normalizeMarkdownForDisplay(input)).toBe([
      '# 🌟星光森林的秘密',
      '',
      '## 第一章：莉莉的发现',
      '',
      '在遥远的北方，有一片被繁星眷顾的神秘森林。',
      '',
      '## 第二章：穿越荆棘沼泽',
      '',
      '按照古树长老的指引，莉莉首先要穿越荆棘沼泽。',
    ].join('\n'));
  });

  it('splits standalone emphasis markers from trailing prose', () => {
    const input = '*（全文完）*我将为您创作一篇完整的童话故事。';

    expect(normalizeMarkdownForDisplay(input)).toBe([
      '*（全文完）*',
      '',
      '我将为您创作一篇完整的童话故事。',
    ].join('\n'));
  });

  it('keeps inline dialogue attribution untouched', () => {
    const input = '"晚安，莉莉！"一朵会说话的夜来香向她打招呼。';

    expect(normalizeMarkdownForDisplay(input)).toBe(input);
  });

  it('does not touch fenced code blocks while repairing surrounding prose', () => {
    const input = [
      '# Title##Chapter One',
      '',
      '```md',
      '# Keep##Literal',
      '```',
    ].join('\n');

    expect(normalizeMarkdownForDisplay(input)).toBe([
      '# Title',
      '',
      '## Chapter One',
      '',
      '```md',
      '# Keep##Literal',
      '```',
    ].join('\n'));
  });
});
