// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { createI18nHelpers } from './createI18n';
import { findProtectedTermViolations, PROTECTED_TERMS } from './protectedTerms';
import { desktopLanguageBridge } from './desktopLanguageBridge';
import { resolveLocalePreference, type RedevenLanguageSnapshot } from './resolveLocale';
import {
  LOCALE_META,
  LOCALE_OPTIONS,
  SUPPORTED_LOCALES,
  SYSTEM_LOCALE_PREFERENCE,
  localeDisplayName,
  normalizeLocalePreference,
} from './localeMeta';
import { dictionaries, enUS } from './locales';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from './storageKey';
import type { EnvAppTranslationShape } from './locales';

type MessageLeaf = string | Readonly<Record<string, string>> | readonly unknown[];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPluralLike(value: unknown): value is Readonly<Record<string, string>> {
  if (!isRecord(value) || typeof value.other !== 'string') {
    return false;
  }
  const pluralCategories = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
  return Object.entries(value).every(([key, message]) => (
    pluralCategories.has(key) && typeof message === 'string'
  ));
}

function collectLeaves(value: unknown, prefix = ''): Readonly<Record<string, MessageLeaf>> {
  if (typeof value === 'string' || Array.isArray(value) || isPluralLike(value)) {
    return { [prefix]: value };
  }
  if (!isRecord(value)) {
    return {};
  }
  const entries: Record<string, MessageLeaf> = {};
  for (const [key, child] of Object.entries(value)) {
    Object.assign(entries, collectLeaves(child, prefix ? `${prefix}.${key}` : key));
  }
  return entries;
}

function stringsForLeaf(value: MessageLeaf): readonly string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.map((part) => JSON.stringify(part));
  }
  return Object.values(value).filter((message): message is string => typeof message === 'string');
}

function placeholderSet(messages: readonly string[]): Set<string> {
  const placeholders = new Set<string>();
  for (const message of messages) {
    for (const match of message.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
      placeholders.add(match[1] ?? '');
    }
  }
  placeholders.delete('');
  return placeholders;
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function listSourceFiles(root: string): readonly string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const resolved = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'locales') {
        continue;
      }
      files.push(...listSourceFiles(resolved));
      continue;
    }
    if (/\.(test|spec)\.[cm]?tsx?$/.test(entry.name)) {
      continue;
    }
    if (/\.[cm]?tsx?$/.test(entry.name)) {
      files.push(resolved);
    }
  }
  return files;
}

function collectLiteralTranslationKeysFromSource(root: string): ReadonlyMap<string, readonly string[]> {
  const keyPattern = '([A-Za-z][A-Za-z0-9_-]*(?:\\.[A-Za-z][A-Za-z0-9_-]*)+)';
  const directCallPattern = new RegExp(`(?:^|[^\\w.])(?:props\\.i18n\\.|[A-Za-z_$][A-Za-z0-9_$]*(?:\\([^)]*\\))?\\.)?(?:t|tn|rich|translateEnvAppKey)\\(\\s*['"\`]${keyPattern}['"\`]`, 'g');
  const keyFieldPattern = new RegExp(`\\b(?:titleKey|labelKey|valueKey|contentKey|helpKey|placeholderKey|descriptionKey|detailKey|messageKey|ariaLabelKey)\\s*:\\s*['"\`]${keyPattern}['"\`]`, 'g');
  const returnLiteralPattern = new RegExp(`\\breturn\\s+['"\`]${keyPattern}['"\`]\\s*;`, 'g');
  const typeAssertionPattern = new RegExp(`['"\`]${keyPattern}['"\`]\\s+as\\s+EnvAppTranslationKey\\b`, 'g');
  const statusTemplatePattern = /`chatActivity\.status\.\$\{status\}`\s+as\s+EnvAppTranslationKey\b/g;
  const found = new Map<string, string[]>();

  for (const file of listSourceFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    const relativeFile = path.relative(root, file);
    for (const pattern of [
      directCallPattern,
      keyFieldPattern,
      returnLiteralPattern,
      typeAssertionPattern,
    ]) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const key = match[1];
        if (!key) {
          continue;
        }
        found.set(key, [...(found.get(key) ?? []), relativeFile]);
      }
    }
    if (statusTemplatePattern.test(source)) {
      found.set('chatActivity.status.${status}', [
        ...(found.get('chatActivity.status.${status}') ?? []),
        relativeFile,
      ]);
    }
    statusTemplatePattern.lastIndex = 0;
  }

  return found;
}

function expandDynamicTranslationKeys(keys: ReadonlyMap<string, readonly string[]>): Set<string> {
  const expanded = new Set(keys.keys());
  if (expanded.has('chatActivity.status.${status}')) {
    expanded.delete('chatActivity.status.${status}');
    for (const status of ['pending', 'running', 'success', 'error', 'waiting', 'info']) {
      expanded.add(`chatActivity.status.${status}`);
    }
  }
  return expanded;
}

describe('Env App i18n metadata', () => {
  it('defines ten real locales plus a separate system preference mode', () => {
    expect(SUPPORTED_LOCALES).toEqual([
      'en-US',
      'zh-CN',
      'zh-TW',
      'ja-JP',
      'ko-KR',
      'de-DE',
      'fr-FR',
      'es-ES',
      'pt-BR',
      'ru-RU',
    ]);
    expect(LOCALE_OPTIONS).toHaveLength(10);
    expect(SYSTEM_LOCALE_PREFERENCE).toBe('system');
  });

  it('keeps metadata displayable for each supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_META[locale].id).toBe(locale);
      expect(LOCALE_META[locale].htmlLang).toBe(locale);
      expect(LOCALE_META[locale].textDirection).toBe('ltr');
      expect(localeDisplayName(locale).length).toBeGreaterThan(0);
    }
  });
});

describe('Env App i18n resolver', () => {
  it.each([
    ['en-GB', 'en-US'],
    ['zh-Hant', 'zh-TW'],
    ['zh-Hant-HK', 'zh-TW'],
    ['zh_Hant_HK', 'zh-TW'],
    ['zh-MO', 'zh-TW'],
    ['zh-SG', 'zh-CN'],
    ['ja', 'ja-JP'],
    ['ko', 'ko-KR'],
    ['de-CH', 'de-DE'],
    ['fr-CA', 'fr-FR'],
    ['es-419', 'es-ES'],
    ['pt-PT', 'pt-BR'],
    ['ru', 'ru-RU'],
  ] as const)('maps system candidate %s to %s', (candidate, expected) => {
    expect(resolveLocalePreference({ preference: 'system', systemCandidates: [candidate] })).toMatchObject({
      preference: 'system',
      resolved_locale: expected,
      source: 'system',
    });
  });

  it('keeps explicit supported preferences ahead of browser candidates', () => {
    expect(resolveLocalePreference({ preference: 'fr-FR', systemCandidates: ['zh-CN'] })).toMatchObject({
      preference: 'fr-FR',
      resolved_locale: 'fr-FR',
      source: 'explicit',
    });
  });

  it.each([
    ['zh-cn', 'zh-CN'],
    ['ZH-tw', 'zh-TW'],
    ['ja-jp', 'ja-JP'],
    ['PT-br', 'pt-BR'],
    ['system', 'system'],
    ['bogus', 'system'],
  ] as const)('normalizes explicit preference %s to %s like Desktop', (input, expected) => {
    expect(normalizeLocalePreference(input)).toBe(expected);
    expect(resolveLocalePreference({ preference: input, systemCandidates: ['de-DE'] }).preference).toBe(expected);
  });
});

describe('Env App Desktop language bridge', () => {
  it('accepts only validated Desktop language snapshots', () => {
    const original = window.redevenDesktopLanguage;
    const validSnapshot: RedevenLanguageSnapshot = {
      preference: 'zh-TW',
      resolved_locale: 'zh-TW',
      source: 'explicit',
      system_candidates: ['zh-Hant-HK'],
    };

    window.redevenDesktopLanguage = {
      getSnapshot: () => validSnapshot,
      setPreference: () => validSnapshot,
      subscribe: () => () => undefined,
    };
    expect(desktopLanguageBridge()).not.toBeNull();

    window.redevenDesktopLanguage = {
      getSnapshot: () => ({
        preference: 'system',
        resolved_locale: 'xx-TEST',
        source: 'system',
        system_candidates: [],
      }) as unknown as RedevenLanguageSnapshot,
      setPreference: () => validSnapshot,
      subscribe: () => () => undefined,
    };
    expect(desktopLanguageBridge()).toBeNull();

    window.redevenDesktopLanguage = original;
  });

  it('rejects explicit snapshots where preference and resolved locale disagree', () => {
    const original = window.redevenDesktopLanguage;
    const invalidSnapshot = {
      preference: 'ja-JP',
      resolved_locale: 'ko-KR',
      source: 'explicit',
      system_candidates: [],
    } as unknown as RedevenLanguageSnapshot;

    window.redevenDesktopLanguage = {
      getSnapshot: () => invalidSnapshot,
      setPreference: () => invalidSnapshot,
      subscribe: () => () => undefined,
    };
    expect(desktopLanguageBridge()).toBeNull();

    window.redevenDesktopLanguage = original;
  });

  it('ignores invalid snapshots emitted after bridge validation', () => {
    const original = window.redevenDesktopLanguage;
    const validSnapshot: RedevenLanguageSnapshot = {
      preference: 'system',
      resolved_locale: 'en-US',
      source: 'fallback',
      system_candidates: [],
    };
    const invalidSnapshot = {
      preference: 'zh-CN',
      resolved_locale: 'pt-BR',
      source: 'system',
      system_candidates: ['pt-PT'],
    } as unknown as RedevenLanguageSnapshot;
    const subscribers: Array<(snapshot: RedevenLanguageSnapshot) => void> = [];

    window.redevenDesktopLanguage = {
      getSnapshot: () => validSnapshot,
      setPreference: () => invalidSnapshot,
      subscribe: (listener) => {
        subscribers.push(listener);
        return () => undefined;
      },
    };

    const bridge = desktopLanguageBridge();
    const received: RedevenLanguageSnapshot[] = [];
    bridge?.subscribe((snapshot) => received.push(snapshot));
    subscribers[0]?.(invalidSnapshot);

    expect(bridge?.setPreference('zh-CN')).toMatchObject({
      preference: 'zh-CN',
      resolved_locale: 'zh-CN',
      source: 'explicit',
    });
    expect(received).toEqual([]);

    window.redevenDesktopLanguage = original;
  });
});

describe('Env App i18n dictionaries', () => {
  it('preserves protected product terms across localized dictionaries', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(findProtectedTermViolations(enUS, dictionaries[locale], locale)).toEqual([]);
    }
  });

  it('keeps every locale shape and placeholders aligned with en-US', () => {
    const sourceLeaves = collectLeaves(enUS);
    const sourceKeys = Object.keys(sourceLeaves).sort();
    for (const locale of SUPPORTED_LOCALES) {
      const targetLeaves = collectLeaves(dictionaries[locale]);
      expect(Object.keys(targetLeaves).sort()).toEqual(sourceKeys);
      for (const key of sourceKeys) {
        const source = sourceLeaves[key];
        const target = targetLeaves[key];
        expect(typeof target).toBe(typeof source);
        expect(sameSet(
          placeholderSet(stringsForLeaf(source)),
          placeholderSet(stringsForLeaf(target)),
        )).toBe(true);
      }
    }
  });

  it('keeps ru-RU plural messages wired for Russian plural categories', () => {
    const ruLeaves = collectLeaves(dictionaries['ru-RU']);
    for (const [key, value] of Object.entries(ruLeaves)) {
      if (!isPluralLike(value)) {
        continue;
      }
      expect(value, key).toHaveProperty('one');
      expect(value, key).toHaveProperty('few');
      expect(value, key).toHaveProperty('many');
      expect(value, key).toHaveProperty('other');
    }
  });

  it('formats translated strings and plural messages through the locale helpers', () => {
    const zhCN = createI18nHelpers('zh-CN');
    expect(zhCN.t('language.updatedMessage', { language: '简体中文' })).toBe('Redeven 将使用 简体中文。');
    expect(zhCN.tn('language.availableCount', 10)).toBe('10 种语言');
    expect(zhCN.t('shell.commandPalette.changeLanguageTitle')).toBe('更改语言');
    expect(zhCN.t('accessGate.notice')).toContain('Runtime');
    expect(zhCN.t('chatChrome.copyMessage')).toBe('复制消息');
    expect(zhCN.t('chatActivity.command')).toBe('命令');
    expect(zhCN.t('chatActivity.noneOfTheAbove')).toBe('以上都不是');
    expect(zhCN.t('chatActivity.readyToContinue')).toBe('可以继续。');
    expect(zhCN.t('filePreview.saveFile')).toBe('保存文件');
    expect(zhCN.t('shell.nav.terminal')).toBe('终端');
    expect(zhCN.t('shell.nav.webServices')).toBe('Web服务');
    expect(zhCN.t('shell.topbar.notesOverlay')).toBe('便签');
    expect(zhCN.t('workbench.widgets.terminal.label')).toBe('终端');
    expect(zhCN.t('workbench.widgets.ports.label')).toBe('Web服务');
    expect(zhCN.t('workbench.contextMenu.addWidget', { label: '终端' })).toBe('添加 终端');
    expect(zhCN.t('workbench.contextMenu.goToWidget', { label: 'Web服务' })).toBe('转到 Web服务');
    expect(zhCN.t('deck.presets.terminalFocus')).toBe('终端聚焦');
    expect(zhCN.t('codespacesSettings.portRange')).toBe('端口范围');
    expect(zhCN.t('codeRuntime.rows.managedEditorSource')).toBe('托管编辑器来源');
    expect(zhCN.t('codeRuntime.currentEditorSection')).toBe('当前编辑器');
    expect(zhCN.t('codeRuntime.useThisVersion')).toBe('使用此版本');
    expect(zhCN.t('codeRuntime.notes.codespacesUsesSelectedManagedVersion')).toBe('Codespaces 使用已选择的托管 Browser Editor 版本。');
    expect(zhCN.t('codeRuntime.activity.steps.cache')).toBe('下载到 Desktop');

    const deDE = createI18nHelpers('de-DE');
    expect(deDE.t('chatActivity.command')).toBe('Befehl');
    expect(deDE.t('codespacesSettings.portRange')).toBe('Portbereich');
    expect(deDE.t('codeRuntime.rows.managedEditorSource')).toBe('Quelle des verwalteten Editors');

    const ruRU = createI18nHelpers('ru-RU');
    expect(ruRU.tn('language.availableCount', 1)).toBe('1 язык');
    expect(ruRU.tn('language.availableCount', 2)).toBe('2 языка');
    expect(ruRU.tn('language.availableCount', 5)).toBe('5 языков');
    expect(ruRU.tn('runtimeStatus.workload.tasks', 1)).toBe('1 задача');
    expect(ruRU.tn('runtimeStatus.workload.tasks', 2)).toBe('2 задачи');
    expect(ruRU.tn('runtimeStatus.workload.tasks', 5)).toBe('5 задач');
    expect(ruRU.tn('chatActivity.todoItems', 1)).toBe('1 элемент');
    expect(ruRU.tn('chatActivity.todoItems', 2)).toBe('2 элемента');
    expect(ruRU.tn('chatActivity.todoItems', 5)).toBe('5 элементов');
    expect(ruRU.tn('chatActivity.fileCount', 1)).toBe('1 файл');
    expect(ruRU.tn('chatActivity.fileCount', 2)).toBe('2 файла');
    expect(ruRU.tn('chatActivity.fileCount', 5)).toBe('5 файлов');
  });

  it('keeps product chrome translation separate from user and generated content', () => {
    const zhCN = createI18nHelpers('zh-CN');
    const userPrompt = 'Flower should inspect src/main.ts and keep this prompt in English.';
    const aiReply = 'I will read the file, then run npm test.';
    const code = 'const Flower = "prompt text stays literal";';
    const terminalOutput = 'npm test\nPASS src/main.test.ts';

    expect(zhCN.t('chatChrome.copyMessage')).toBe('复制消息');
    expect(userPrompt).toBe('Flower should inspect src/main.ts and keep this prompt in English.');
    expect(aiReply).toBe('I will read the file, then run npm test.');
    expect(code).toBe('const Flower = "prompt text stays literal";');
    expect(terminalOutput).toBe('npm test\nPASS src/main.test.ts');
  });

  it('checks protected terms inside plural messages', () => {
    expect(findProtectedTermViolations(
      {
        ...enUS,
        language: {
          ...enUS.language,
          availableCount: {
            one: '{count} Runtime issue',
            other: '{count} Runtime issues',
          },
        },
      },
      {
        ...enUS,
        language: {
          ...enUS.language,
          availableCount: {
            one: '{count} issue',
            other: '{count} issues',
          },
        },
      },
      'xx-TEST',
    )).toContainEqual({
      key: 'language.availableCount',
      locale: 'xx-TEST',
      term: 'Runtime',
    });
  });

  it('checks protected terms inside rich text messages', () => {
    expect(findProtectedTermViolations(
      ({
        ...enUS,
        aiChrome: {
          ...enUS.aiChrome,
          flowerTitle: [{ type: 'text', value: 'Open Flower' }],
        },
      } as unknown as EnvAppTranslationShape),
      ({
        ...enUS,
        aiChrome: {
          ...enUS.aiChrome,
          flowerTitle: [{ type: 'text', value: 'Open assistant' }],
        },
      } as unknown as EnvAppTranslationShape),
      'xx-TEST',
    )).toContainEqual({
      key: 'aiChrome.flowerTitle',
      locale: 'xx-TEST',
      term: 'Flower',
    });
  });

  it('keeps literal translation keys used by UI source files present in the base dictionary', () => {
    const sourceRoot = path.resolve(process.cwd(), 'src/ui');
    const keys = collectLiteralTranslationKeysFromSource(sourceRoot);
    const availableKeys = new Set(Object.keys(collectLeaves(enUS)));
    const expandedKeys = expandDynamicTranslationKeys(keys);
    const missing = [...expandedKeys]
      .filter((key) => !availableKeys.has(key))
      .map((key) => `${key} (${[...new Set(keys.get(key) ?? ['dynamic key expansion'])].sort().join(', ')})`)
      .sort();

    expect(missing).toEqual([]);
  });
});

describe('Env App and Desktop i18n contract', () => {
  it('keeps storage keys and supported locale order aligned with Desktop', () => {
    const desktopLocaleMeta = fs.readFileSync(
      path.resolve(process.cwd(), '../../../desktop/src/shared/i18n/localeMeta.ts'),
      'utf8',
    );
    const desktopStorageKey = fs.readFileSync(
      path.resolve(process.cwd(), '../../../desktop/src/shared/i18n/storageKey.ts'),
      'utf8',
    );

    for (const locale of SUPPORTED_LOCALES) {
      expect(desktopLocaleMeta).toContain(`'${locale}'`);
    }
    expect(desktopStorageKey).toContain(`'${REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY}'`);
  });

  it('keeps resolver aliases and protected term contracts aligned with Desktop', () => {
    const desktopLocaleMeta = fs.readFileSync(
      path.resolve(process.cwd(), '../../../desktop/src/shared/i18n/localeMeta.ts'),
      'utf8',
    );
    const desktopResolver = fs.readFileSync(
      path.resolve(process.cwd(), '../../../desktop/src/shared/i18n/resolveLocale.ts'),
      'utf8',
    );
    const desktopProtectedTerms = fs.readFileSync(
      path.resolve(process.cwd(), '../../../desktop/src/shared/i18n/protectedTerms.ts'),
      'utf8',
    );

    expect(desktopResolver).toContain("case 'en':");
    expect(desktopResolver).toContain("case 'de':");
    expect(desktopResolver).toContain("case 'fr':");
    expect(desktopResolver).toContain("case 'es':");
    expect(desktopResolver).toContain("case 'pt':");
    expect(desktopResolver).toContain("parts.includes('hant')");
    expect(desktopResolver).toContain("parts.includes('hk')");
    expect(desktopResolver).toContain("parts.includes('mo')");
    expect(desktopResolver).toContain("return 'zh-TW'");
    expect(desktopResolver).toContain("return 'zh-CN'");
    expect(desktopResolver).toContain("return 'pt-BR'");
    expect(desktopLocaleMeta).toContain('REDEVEN_LOCALE_PREFERENCES');
    expect(desktopLocaleMeta).toContain('SYSTEM_LOCALE_PREFERENCE');
    for (const term of PROTECTED_TERMS) {
      expect(desktopProtectedTerms).toContain(`'${term}'`);
    }
  });
});
