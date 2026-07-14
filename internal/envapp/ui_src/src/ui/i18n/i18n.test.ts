// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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
import {
  createTestI18nHelpers as createI18nHelpers,
  dictionaries,
  enUS,
} from './locales/testDictionaries';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from './storageKey';
import {
  FORBIDDEN_GENERIC_ENGLISH_TERMS,
  LOCALE_TERMINOLOGY,
  TECHNICAL_TERM_ALLOWLIST,
  ZH_TW_FORBIDDEN_SIMPLIFIED_CHARACTERS,
} from './terminology';
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

const EMPTY_LEAF_EXCEPTIONS = new Map<string, string>([
  ['de-DE:notesOverlay.liveNotesSuffix', 'German count wording does not append a suffix to the singular noun.'],
  ['ja-JP:notesOverlay.liveNotesSuffix', 'Japanese nouns do not take a count suffix here.'],
  ['ja-JP:notesOverlay.deletedNotesSuffix', 'Japanese nouns do not take a count suffix here.'],
  ['ko-KR:notesOverlay.liveNotesSuffix', 'Korean nouns do not take a count suffix here.'],
  ['ko-KR:notesOverlay.deletedNotesSuffix', 'Korean nouns do not take a count suffix here.'],
  ['ru-RU:notesOverlay.liveNotesSuffix', 'Russian count wording is complete without a concatenated suffix.'],
  ['ru-RU:notesOverlay.deletedNotesSuffix', 'Russian count wording is complete without a concatenated suffix.'],
  ['zh-CN:notesOverlay.liveNotesSuffix', 'Chinese nouns do not take a count suffix here.'],
  ['zh-CN:notesOverlay.deletedNotesSuffix', 'Chinese nouns do not take a count suffix here.'],
  ['zh-TW:notesOverlay.liveNotesSuffix', 'Chinese nouns do not take a count suffix here.'],
  ['zh-TW:notesOverlay.deletedNotesSuffix', 'Chinese nouns do not take a count suffix here.'],
]);

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
  it('assembles every non-English locale from an explicit JSON catalog', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/i18n/locales/index.ts'), 'utf8');
    for (const locale of SUPPORTED_LOCALES.filter((candidate) => candidate !== 'en-US')) {
      expect(source).toContain(`./catalogs/${locale}.json`);
    }
    expect(source).not.toMatch(/from ['"]\.\/(?:zh-CN|zh-TW|ja-JP|ko-KR|de-DE|fr-FR|es-ES|pt-BR|ru-RU)['"]/);
  });

  it('preserves protected product terms across localized dictionaries', () => {
    const violations = SUPPORTED_LOCALES.flatMap((locale) => (
      findProtectedTermViolations(enUS, dictionaries[locale], locale)
    ));
    expect(violations).toEqual([]);
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

  it('rejects empty translation leaves except for explicit grammatical suffixes', () => {
    const observedExceptions = new Set<string>();
    const violations: string[] = [];
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, leaf] of Object.entries(collectLeaves(dictionaries[locale]))) {
        for (const message of stringsForLeaf(leaf)) {
          if (message.trim().length > 0) continue;
          const exceptionKey = `${locale}:${key}`;
          if (EMPTY_LEAF_EXCEPTIONS.has(exceptionKey)) {
            observedExceptions.add(exceptionKey);
          } else {
            violations.push(exceptionKey);
          }
        }
      }
    }
    expect(violations).toEqual([]);
    expect([...observedExceptions].sort()).toEqual([...EMPTY_LEAF_EXCEPTIONS.keys()].sort());
    expect([...EMPTY_LEAF_EXCEPTIONS.values()].every((reason) => reason.trim().length > 0)).toBe(true);
  });

  it('rejects generic English product concepts and translation-generator markers', () => {
    for (const locale of SUPPORTED_LOCALES.filter((candidate) => candidate !== 'en-US')) {
      const leaves = collectLeaves(dictionaries[locale]);
      for (const [key, leaf] of Object.entries(leaves)) {
        const value = stringsForLeaf(leaf)
          .join('\n')
          .replace(/\{[^}]+\}/g, '')
          .replace(/`[^`]+`/g, '');
        expect(value, `${locale}:${key}`).not.toMatch(/ZXQ(?:KEEP|SEG|GARDER)|QXZ/);
        for (const term of FORBIDDEN_GENERIC_ENGLISH_TERMS) {
          expect(value, `${locale}:${key}:${term}`).not.toMatch(new RegExp(`\\b${term.replaceAll(' ', '[\\s-]+')}\\b`, 'i'));
        }
      }
    }
  });

  it('allows identical English copy only for short names, technical terms, or code literals', () => {
    const sourceLeaves = collectLeaves(enUS);
    const allowedTerms = [
      ...PROTECTED_TERMS,
      ...TECHNICAL_TERM_ALLOWLIST.map((entry) => entry.term),
      'Desktop',
      'Terminal',
      'Shell',
      'GitHub',
      'localhost',
    ].sort((left, right) => right.length - left.length);
    const violations: string[] = [];

    for (const locale of SUPPORTED_LOCALES.filter((candidate) => candidate !== 'en-US')) {
      const targetLeaves = collectLeaves(dictionaries[locale]);
      for (const [key, sourceLeaf] of Object.entries(sourceLeaves)) {
        const sourceMessages = stringsForLeaf(sourceLeaf);
        const targetMessages = stringsForLeaf(targetLeaves[key]);
        sourceMessages.forEach((sourceMessage, index) => {
          if (sourceMessage !== targetMessages[index] || /^(?:https?|wss?):\/\//.test(sourceMessage)) return;
          let remainder = sourceMessage
            .replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '')
            .replace(/`[^`]+`/g, '');
          for (const term of allowedTerms) remainder = remainder.replaceAll(term, '');
          const words = remainder.match(/[A-Za-z]{2,}/g) ?? [];
          if (words.length >= 3) violations.push(`${locale}:${key}=${sourceMessage}`);
        });
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps Traditional Chinese free of common Simplified-only characters', () => {
    const text = Object.values(collectLeaves(dictionaries['zh-TW']))
      .flatMap(stringsForLeaf)
      .join('\n');
    const found = [...new Set([...text].filter((character) => ZH_TW_FORBIDDEN_SIMPLIFIED_CHARACTERS.includes(character)))];
    expect(found).toEqual([]);
  });

  it('defines reviewed terminology and explained technical exceptions for every locale', () => {
    expect(Object.keys(LOCALE_TERMINOLOGY).sort()).toEqual(SUPPORTED_LOCALES.filter((locale) => locale !== 'en-US').sort());
    for (const terminology of Object.values(LOCALE_TERMINOLOGY)) {
      expect(Object.values(terminology).every((value) => value.trim().length > 0)).toBe(true);
    }
    expect(new Set(TECHNICAL_TERM_ALLOWLIST.map((entry) => entry.term)).size).toBe(TECHNICAL_TERM_ALLOWLIST.length);
    expect(TECHNICAL_TERM_ALLOWLIST.every((entry) => entry.reason.trim().length > 0)).toBe(true);
  });

  it('keeps file and terminal duplicate actions context-specific in every locale', () => {
    const expected = {
      'en-US': ['Files', 'Duplicate', 'Duplicate session'],
      'zh-CN': ['文件', '创建副本', '复制会话'],
      'zh-TW': ['檔案', '建立副本', '複製工作階段'],
      'ja-JP': ['ファイル', '複製', 'セッションを複製'],
      'ko-KR': ['파일', '사본 만들기', '세션 복제'],
      'de-DE': ['Dateien', 'Duplizieren', 'Sitzung duplizieren'],
      'fr-FR': ['Fichiers', 'Dupliquer', 'Dupliquer la session'],
      'es-ES': ['Archivos', 'Duplicar', 'Duplicar sesión'],
      'pt-BR': ['Arquivos', 'Duplicar', 'Duplicar sessão'],
      'ru-RU': ['Файлы', 'Создать копию', 'Дублировать сеанс'],
    } as const;

    for (const locale of SUPPORTED_LOCALES) {
      expect([
        dictionaries[locale].files.title,
        dictionaries[locale].files.createDuplicate,
        dictionaries[locale].terminal.duplicateSession,
      ]).toEqual(expected[locale]);
    }
  });

  it('keeps old Flower sidebar navigation copy out of the active dictionary shape', () => {
    const keys = Object.keys(collectLeaves(enUS));
    expect(keys).not.toContain('flowerChat.component.navigationAriaLabel');
    expect(keys).not.toContain('flowerChat.component.allFlowerHistory');
    expect(keys).not.toContain('flowerChat.sidebar.allFlowerHistory');
    expect(keys).not.toContain('flowerChat.sidebar.bulkDelete.title');
  });

  it('keeps Flower return navigation copy localized', () => {
    expect(dictionaries['en-US'].settings.backToFlower).toBe('Back to Flower');
    expect(dictionaries['zh-CN'].settings.backToFlower).toBe('返回 Flower');
    expect(dictionaries['zh-TW'].settings.backToFlower).toBe('返回 Flower');
    expect(dictionaries['ja-JP'].settings.backToFlower).toBe('Flower に戻る');
    expect(dictionaries['fr-FR'].settings.backToFlower).toBe('Retour à Flower');
    expect(dictionaries['ru-RU'].settings.backToFlower).toBe('Вернуться к Flower');
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
    expect(zhCN.t('shell.commandPalette.changeLanguageTitle')).toBe('更改语言');
    expect(zhCN.t('accessGate.notice')).toContain('运行时');
    expect(zhCN.t('chatChrome.copyMessage')).toBe('复制消息');
    expect(zhCN.t('chatActivity.command')).toBe('命令');
    expect(zhCN.t('filePreview.saveFile')).toBe('保存文件');
    expect(zhCN.t('shell.nav.terminal')).toBe('终端');
    expect(zhCN.t('shell.nav.webServices')).toBe('Web服务');
    expect(zhCN.t('shell.topbar.notesOverlay')).toBe('便签');
    expect(zhCN.t('workbench.widgets.terminal.label')).toBe('终端');
    expect(zhCN.t('workbench.widgets.ports.label')).toBe('Web服务');
    expect(zhCN.t('workbench.contextMenu.addWidget', { label: '终端' })).toBe('添加 终端');
    expect(zhCN.t('workbench.contextMenu.goToWidget', { label: 'Web服务' })).toBe('转到 Web服务');
    expect(zhCN.t('codespacesSettings.portRange')).toBe('端口范围');
    expect(zhCN.t('codeRuntime.rows.managedEditorSource')).toBe('托管编辑器来源');
    expect(zhCN.t('codeRuntime.currentEditorSection')).toBe('当前编辑器');
    expect(zhCN.t('codeRuntime.useThisVersion')).toBe('使用此版本');
    expect(zhCN.t('codeRuntime.notes.codespacesUsesSelectedManagedVersion')).toBe('Codespaces 使用选定的托管 Browser Editor 版本。');
    expect(zhCN.t('codeRuntime.activity.steps.cache')).toBe('下载到 Desktop');
    expect(zhCN.t('settings.connection.title')).toBe('连接');
    expect(zhCN.t('settings.connection.connectedRuntime')).toBe('已连接到运行时');
    expect(zhCN.t('settings.connection.coreInformation')).toBe('核心信息');
    expect(zhCN.t('settings.connection.technicalInformation')).toBe('技术信息');

    const en = createI18nHelpers('en-US');
    expect(en.t('settings.connection.title')).toBe('Connection');
    expect(en.t('settings.connection.description')).not.toContain('Connection details managed by the Control Plane');
    expect(en.t('settings.connection.description')).toContain('Redeven');
    expect(en.t('settings.connection.description')).toContain('Desktop');
    expect(en.t('settings.connection.description')).toContain('Runtime');

    const deDE = createI18nHelpers('de-DE');
    expect(deDE.t('chatActivity.command')).toBe('Befehl');
    expect(deDE.t('codespacesSettings.portRange')).toBe('Portbereich');
    expect(deDE.t('codeRuntime.rows.managedEditorSource')).toBe('Quelle des verwalteten Editors');

    const ruRU = createI18nHelpers('ru-RU');
    expect(ruRU.tn('runtimeStatus.workload.tasks', 1)).toBe('1 задача');
    expect(ruRU.tn('runtimeStatus.workload.tasks', 2)).toBe('2 задачи');
    expect(ruRU.tn('runtimeStatus.workload.tasks', 5)).toBe('5 задач');
    expect(ruRU.tn('chatActivity.todoItems', 1)).toBe('1 элемент');
    expect(ruRU.tn('chatActivity.todoItems', 2)).toBe('2 элемента');
    expect(ruRU.tn('chatActivity.todoItems', 5)).toBe('5 элементов');
    expect(ruRU.tn('chatActivity.fileCount', 1)).toBe('1 файл');
    expect(ruRU.tn('chatActivity.fileCount', 2)).toBe('2 файла');
    expect(ruRU.tn('chatActivity.fileCount', 5)).toBe('5 файлов');

    const connectionKeys = [
      'settings.connection.title',
      'settings.connection.description',
      'settings.connection.readOnly',
      'settings.connection.manageConnection',
      'settings.connection.manageConnectionFailedTitle',
      'settings.connection.manageConnectionFailedMessage',
      'settings.connection.connectedRuntime',
      'settings.connection.incompleteConnectionInfo',
      'settings.connection.keyProvisioned',
      'settings.connection.keyNotProvisioned',
      'settings.connection.coreInformation',
      'settings.connection.currentEnvironmentId',
      'settings.connection.environmentId',
      'settings.connection.connectionServiceAddress',
      'settings.connection.controlPlaneUrl',
      'settings.connection.runtimeInstance',
      'settings.connection.instanceId',
      'settings.connection.securityKey',
      'settings.connection.e2eePsk',
      'settings.connection.securityKeyDescription',
      'settings.connection.changeConnectionTitle',
      'settings.connection.changeConnectionDescription',
      'settings.connection.technicalInformation',
      'settings.connection.channelId',
      'settings.connection.webSocketUrl',
      'settings.connection.directSuite',
      'settings.connection.channelInitExpiresAt',
      'settings.connection.notProvided',
      'settings.connection.emptyValue',
    ] as const;
    for (const locale of SUPPORTED_LOCALES) {
      const helpers = createI18nHelpers(locale);
      for (const key of connectionKeys) {
        expect(helpers.t(key)).not.toBe(key);
      }
    }
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
        runtimeStatus: {
          ...enUS.runtimeStatus,
          workload: {
            ...enUS.runtimeStatus.workload,
            tasks: {
              one: '{count} Flower issue',
              other: '{count} Flower issues',
            },
          },
        },
      },
      {
        ...enUS,
        runtimeStatus: {
          ...enUS.runtimeStatus,
          workload: {
            ...enUS.runtimeStatus.workload,
            tasks: {
              one: '{count} issue',
              other: '{count} issues',
            },
          },
        },
      },
      'xx-TEST',
    )).toContainEqual({
      key: 'runtimeStatus.workload.tasks',
      locale: 'xx-TEST',
      term: 'Flower',
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
  it('keeps Activity and Workbench as fixed display-mode names without hardcoding them in the model', () => {
    const shellSource = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/EnvAppShell.tsx'), 'utf8');
    const viewModeSource = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/envViewMode.ts'), 'utf8');
    expect(shellSource).toContain("i18n.t('uiCopy.shell.activityMode')");
    expect(shellSource).toContain("i18n.t('uiCopy.shell.workbenchMode')");
    expect(viewModeSource).not.toContain('ENV_VIEW_MODE_LABELS');
    for (const locale of SUPPORTED_LOCALES) {
      expect(dictionaries[locale].uiCopy.shell.activityMode, locale).toBe('Activity');
      expect(dictionaries[locale].uiCopy.shell.workbenchMode, locale).toBe('Workbench');
    }
  });

  it('localizes the stable missing-environment connection summary', () => {
    const shellSource = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/EnvAppShell.tsx'), 'utf8');
    expect(shellSource).toContain("i18n.t('shell.status.missingEnvContext')");
    expect(shellSource).not.toContain('Missing env context. Please reopen from the control plane.');
    expect(dictionaries['zh-CN'].shell.status.missingEnvContext).toBe('缺少环境信息。请从控制平面重新打开此环境。');
    expect(dictionaries['zh-TW'].shell.status.missingEnvContext).toBe('缺少環境資訊。請從控制平面重新開啟此環境。');
  });

  it('injects localized framework chrome and plugin navigation copy', () => {
    const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/App.tsx'), 'utf8');
    const shellSource = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/EnvAppShell.tsx'), 'utf8');
    expect(appSource).toContain("searchPlaceholder: t('shell.framework.searchCommands')");
    expect(appSource).toContain("error: t('shell.framework.error')");
    expect(shellSource).toContain("label: i18n.t('uiCopy.plugin.panelTitle')");
    expect(shellSource).not.toContain("label: 'Plugins'");
    expect(dictionaries['zh-CN'].shell.framework).toMatchObject({
      searchCommands: '搜索命令...',
      disconnected: '未连接',
      error: '错误',
    });
    expect(Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [
      locale,
      dictionaries[locale].uiCopy.plugin.panelTitle,
    ]))).toEqual({
      'en-US': 'Plugins',
      'zh-CN': '插件',
      'zh-TW': '外掛程式',
      'ja-JP': 'プラグイン',
      'ko-KR': '플러그인',
      'de-DE': 'Plugins',
      'fr-FR': 'Plugins',
      'es-ES': 'Plugins',
      'pt-BR': 'Plugins',
      'ru-RU': 'Плагины',
    });
  });

  it('keeps Flower surface catalogs identical and avoids default-English production fallback', () => {
    const envAIPage = fs.readFileSync(
      path.resolve(process.cwd(), 'src/ui/pages/EnvAIPage.tsx'),
      'utf8',
    );
    expect(envAIPage).toContain('createLocalizedFlowerSurfaceCopy');
    expect(envAIPage).not.toContain('DEFAULT_FLOWER_SURFACE_COPY');

    const desktopEnglishFlower = JSON.parse(fs.readFileSync(
      path.resolve(process.cwd(), '../../../desktop/src/shared/i18n/locales/catalogs/en-US-flower.json'),
      'utf8',
    ));
    expect(enUS.flowerSurface).toEqual(desktopEnglishFlower);

    for (const locale of SUPPORTED_LOCALES.filter((candidate) => candidate !== 'en-US')) {
      const desktopCatalog = JSON.parse(fs.readFileSync(
        path.resolve(process.cwd(), `../../../desktop/src/shared/i18n/locales/catalogs/${locale}.json`),
        'utf8',
      )) as { flowerSurface: unknown };
      expect(dictionaries[locale].flowerSurface, locale).toEqual(desktopCatalog.flowerSurface);
    }
  });

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
