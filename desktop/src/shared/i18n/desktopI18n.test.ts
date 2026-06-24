import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createDesktopI18n,
  DESKTOP_I18N_DICTIONARIES,
  localePreferenceDisplayName,
  REDEVEN_LOCALE_META,
  REDEVEN_LOCALE_PREFERENCES,
  REDEVEN_SUPPORTED_LOCALES,
  resolveRedevenLocale,
  SYSTEM_LOCALE_PREFERENCE,
  validateDesktopDictionary,
  validateDictionaryProtectedTerms,
  flattenDictionaryMessages,
  type DesktopTranslationShape,
} from './index';
import { isPluralMessage } from './messageTypes';
import { enUS } from './locales/en-US';

const DESKTOP_TRANSLATION_ROOTS = new Set(
  Object.keys(enUS).filter((key) => key !== 'plural'),
);

const FLOWER_SURFACE_ENGLISH_COPY_ALLOWLIST = new Set([
  'runtime.localEnvironment',
  'chat.entryLabel',
  'chat.contextIndicatorUnknownPercent',
  'settings.apiKey',
  'settings.dialogAPIKey',
  'settings.dialogBaseURL',
  'settings.dialogBraveAPIKey',
]);

function listSourceFiles(root: string): readonly string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const resolved = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (resolved.endsWith(path.join('shared', 'i18n', 'locales'))) {
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
  const directCallPattern = new RegExp(`(?:^|[^\\w.])(?:props\\.i18n\\.|[A-Za-z_$][A-Za-z0-9_$]*(?:\\([^)]*\\))?\\.|createDesktopI18n\\([^)]*\\)\\.)?(?:t|tn|translateDesktopKey)\\(\\s*['"\`]${keyPattern}['"\`]`, 'g');
  const snakeKeyFieldPattern = new RegExp(`\\b(?:title|summary|detail|recovery_hint|interrupt_label|interrupt_detail|label|value|content|help|placeholder|description|message|aria_label|window_title|save_label|access_mode_label)_key\\s*:\\s*['"\`]${keyPattern}['"\`]`, 'g');
  const camelKeyFieldPattern = new RegExp(`\\b(?:titleKey|labelKey|valueKey|contentKey|helpKey|placeholderKey|descriptionKey|detailKey|messageKey|ariaLabelKey)\\s*:\\s*['"\`]${keyPattern}['"\`]`, 'g');
  const returnLiteralPattern = new RegExp(`\\breturn\\s+['"\`]${keyPattern}['"\`]\\s*;`, 'g');
  const typeAssertionPattern = new RegExp(`['"\`]${keyPattern}['"\`]\\s+as\\s+Desktop(?:Plural)?TranslationKey\\b`, 'g');
  const found = new Map<string, string[]>();

  for (const file of listSourceFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of [
      directCallPattern,
      snakeKeyFieldPattern,
      camelKeyFieldPattern,
      returnLiteralPattern,
      typeAssertionPattern,
    ]) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const key = match[1];
        if (!key) {
          continue;
        }
        if (!DESKTOP_TRANSLATION_ROOTS.has(key.split('.')[0] ?? '')) {
          continue;
        }
        const relativeFile = path.relative(root, file);
        found.set(key, [...(found.get(key) ?? []), relativeFile]);
      }
    }
  }

  return found;
}

describe('Desktop shared i18n locale metadata', () => {
  it('defines ten real locales plus the system preference in stable order', () => {
    expect(REDEVEN_SUPPORTED_LOCALES).toEqual([
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
    expect(REDEVEN_LOCALE_PREFERENCES).toEqual([
      SYSTEM_LOCALE_PREFERENCE,
      ...REDEVEN_SUPPORTED_LOCALES,
    ]);
  });

  it('keeps metadata complete and displayable for every locale', () => {
    for (const locale of REDEVEN_SUPPORTED_LOCALES) {
      const meta = REDEVEN_LOCALE_META[locale];
      expect(meta.locale).toBe(locale);
      expect(meta.html_lang).toBe(locale);
      expect(meta.direction).toBe('ltr');
      expect(meta.native_name.length).toBeGreaterThan(0);
      expect(meta.english_name.length).toBeGreaterThan(0);
    }

    expect(localePreferenceDisplayName('system')).toBe('System default');
    expect(localePreferenceDisplayName('zh-CN')).toBe('简体中文 / Simplified Chinese');
    expect(localePreferenceDisplayName('en-US')).toBe('English');
	});

	it('keeps the en-US subagents baseline copy in English', () => {
		const subagents = DESKTOP_I18N_DICTIONARIES['en-US'].flowerSurface.subagents;
		expect({
			title: subagents.title,
			threadIDLabel: subagents.threadIDLabel,
			action: subagents.activity.labels.action,
			thread: subagents.activity.labels.thread,
			agents: subagents.activity.labels.agents,
			total: subagents.activity.labels.total,
			runtime: subagents.activity.labels.runtime,
			agentsCount: subagents.activity.agentsCount,
		}).toEqual({
			title: 'Subagents',
			threadIDLabel: 'Thread',
			action: 'action',
			thread: 'thread',
			agents: 'delegated agents',
			total: 'total',
			runtime: 'runtime',
			agentsCount: '{count} delegated agents',
		});
		expect(JSON.stringify(subagents)).not.toMatch(/Unteragenten|opération|environnement|délégué|nombre total|\bFil\b/);
	});
});

describe('Desktop shared i18n resolver', () => {
  it.each([
    ['en', 'en-US'],
    ['en-US', 'en-US'],
    ['en-GB', 'en-US'],
    ['zh-CN', 'zh-CN'],
    ['zh-Hans', 'zh-CN'],
    ['zh-SG', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    ['zh-Hant', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh-MO', 'zh-TW'],
    ['ja', 'ja-JP'],
    ['ja-JP', 'ja-JP'],
    ['ko', 'ko-KR'],
    ['ko-KR', 'ko-KR'],
    ['de', 'de-DE'],
    ['de-AT', 'de-DE'],
    ['de-CH', 'de-DE'],
    ['fr', 'fr-FR'],
    ['fr-CA', 'fr-FR'],
    ['fr-BE', 'fr-FR'],
    ['es', 'es-ES'],
    ['es-MX', 'es-ES'],
    ['es-419', 'es-ES'],
    ['pt', 'pt-BR'],
    ['pt-BR', 'pt-BR'],
    ['pt-PT', 'pt-BR'],
    ['ru', 'ru-RU'],
    ['ru-RU', 'ru-RU'],
  ] as const)('maps system candidate %s to %s', (candidate, expected) => {
    expect(resolveRedevenLocale('system', [candidate])).toMatchObject({
      preference: 'system',
      resolved_locale: expected,
      source: 'system',
    });
  });

  it('uses explicit supported preferences before system candidates', () => {
    expect(resolveRedevenLocale('fr-FR', ['zh-CN'])).toMatchObject({
      preference: 'fr-FR',
      resolved_locale: 'fr-FR',
      source: 'explicit',
    });
  });

  it('normalizes invalid stored preferences to system and falls back to en-US', () => {
    expect(resolveRedevenLocale('bogus', ['und'])).toEqual({
      preference: 'system',
      resolved_locale: 'en-US',
      source: 'fallback',
      system_candidates: ['und'],
    });
    expect(resolveRedevenLocale('', [])).toMatchObject({
      preference: 'system',
      resolved_locale: 'en-US',
      source: 'fallback',
    });
  });
});

describe('Desktop shared i18n dictionaries', () => {
  it('keep every locale shape, placeholder, and protected term aligned with en-US', () => {
    for (const locale of REDEVEN_SUPPORTED_LOCALES) {
      expect(validateDesktopDictionary(locale, enUS, DESKTOP_I18N_DICTIONARIES[locale])).toEqual([]);
    }
  });

  it('keeps non-English dictionaries assignable to a widened message shape', () => {
    const zhCN: DesktopTranslationShape = DESKTOP_I18N_DICTIONARIES['zh-CN'];
    expect(zhCN.common.open).toBe('打开');
    expect(zhCN.environmentFacts.runsOn).toBe('运行于');
    expect(zhCN.environmentFacts.provider).toBe('提供方');
    expect(zhCN.environmentFacts.sshHost).toBe('SSH主机');
    expect(zhCN.environmentFacts.startedAt).toBe('已启动 {time}');
    expect(zhCN.environmentAction.open).toBe('打开');
    expect(zhCN.environmentAction.runtimeActions).toBe('Runtime 操作');
    expect(zhCN.environmentAction.refreshRuntimeStatus).toBe('刷新 Runtime 状态');
    expect(zhCN.environmentAction.startRuntime).toBe('启动 Runtime');
    expect(zhCN.environmentAction.stopRuntime).toBe('停止 Runtime');
    expect(zhCN.environmentAction.restartRuntime).toBe('重启 Runtime');
    expect(zhCN.environmentAction.updateRuntime).toBe('更新 Runtime');
    expect(zhCN.runtimeMessage.runtimeReadyOpenDetail).toBe('Runtime 已就绪。现在可以打开。');
    expect(zhCN.runtimeMessage.restartRuntimeReady).toBe('Desktop 重启 Runtime 并且它报告就绪后，即可打开。');
    expect(zhCN.shell.backToEnvironments).toBe('返回 Environments');
    expect(zhCN.environmentCenter.askFlowerForLabel).toBe('询问 Flower：{label}');
    expect(zhCN.environmentCenter.askFlowerCardTitle).toBe('询问 Flower');
    expect(zhCN.environmentCenter.askFlowerLauncherQuestion).toBe('想让我先看这个 Environment 的哪一部分？');
    expect(zhCN.environmentCenter.askFlowerLauncherPlaceholder).toBe('告诉 Flower 要检查或协调什么...');
    expect(zhCN.environmentCenter.askFlowerCardContextLabel).toBe('已关联上下文');
    expect(zhCN.environmentCenter.askFlowerWorkingDirectoryUnavailable).toBe('未选择工作目录。');
    expect(zhCN.environmentCenter.askFlowerCardLaunchFailedTitle).toBe('Flower 无法发起这次对话。');
    expect(zhCN.environmentCenter.gatewaysTitle).toBe('Gateways');
    expect(zhCN.environmentCenter.gatewaySearchPlaceholder).toBe('搜索 Gateways...');
    expect(zhCN.environmentCenter.addGateway).toBe('添加 Gateway');
    expect(zhCN.environmentCenter.addGatewayShort).toBe('添加');
    expect(zhCN.environmentCenter.gatewayViewShort).toBe('查看');
    expect(zhCN.environmentCenter.moreActions).toBe('更多操作');
    expect(zhCN.environmentCenter.gatewayGuidanceReadyTitle).toBe('Gateway 已就绪');
    expect(zhCN.environmentCenter.gatewaySummaryMany).toBe('已同步 {count} 个 environments');
    expect(zhCN.environmentStatus.pairingRequired).toBe('需要配对');
    expect('askFlowerCardReadyHint' in zhCN.environmentCenter).toBe(false);
    expect(zhCN.toast.flowerPromptQueued).toBe('已发送给 Flower。');
    expect(zhCN.connectionDialog.sshHost).toBe('SSH主机');
    expect(zhCN.connectionDialog.sshContainer).toBe('SSH主机容器');
    expect(zhCN.runtimeMessage.sshContainerRuntime).toBe('SSH主机容器 Runtime');
  });

  it('keeps Flower surface copy localized for every supported Desktop locale', () => {
    const enFlowerRows = new Map(
      flattenDictionaryMessages(enUS.flowerSurface).map((row) => [row.path, row.value]),
    );

    for (const locale of REDEVEN_SUPPORTED_LOCALES) {
      const copy = DESKTOP_I18N_DICTIONARIES[locale].flowerSurface;
      expect(copy.chat.newChat.length).toBeGreaterThan(0);
      expect(copy.threadList.refreshLabel.length).toBeGreaterThan(0);
      expect(copy.emptyState.reviewPrompt.length).toBeGreaterThan(0);
      expect(copy.settings.addProvider.length).toBeGreaterThan(0);
      expect(copy.settings.backToChat.length).toBeGreaterThan(0);
      if (locale !== 'en-US') {
        expect(copy.chat.send, locale).not.toBe(enUS.flowerSurface.chat.send);
        const englishMatches = flattenDictionaryMessages(copy)
          .filter((row) => (
            row.value === enFlowerRows.get(row.path)
            && !FLOWER_SURFACE_ENGLISH_COPY_ALLOWLIST.has(row.path)
          ))
          .map((row) => row.path);
        expect(englishMatches, locale).toEqual([]);
      }
    }
    expect({
      preparing: DESKTOP_I18N_DICTIONARIES['en-US'].flowerSurface.chat.modelStatusPreparing,
      waitingResponse: DESKTOP_I18N_DICTIONARIES['en-US'].flowerSurface.chat.modelStatusWaitingResponse,
      streaming: DESKTOP_I18N_DICTIONARIES['en-US'].flowerSurface.chat.modelStatusStreaming,
      retrying: DESKTOP_I18N_DICTIONARIES['en-US'].flowerSurface.chat.modelStatusRetrying,
      finalizing: DESKTOP_I18N_DICTIONARIES['en-US'].flowerSurface.chat.modelStatusFinalizing,
    }).toEqual({
      preparing: 'Preparing model request...',
      waitingResponse: 'Waiting for model response...',
      streaming: 'Thinking...',
      retrying: 'Retrying model request...',
      finalizing: 'Finalizing reply...',
    });
    expect({
      preparing: DESKTOP_I18N_DICTIONARIES['zh-CN'].flowerSurface.chat.modelStatusPreparing,
      waitingResponse: DESKTOP_I18N_DICTIONARIES['zh-CN'].flowerSurface.chat.modelStatusWaitingResponse,
      streaming: DESKTOP_I18N_DICTIONARIES['zh-CN'].flowerSurface.chat.modelStatusStreaming,
      retrying: DESKTOP_I18N_DICTIONARIES['zh-CN'].flowerSurface.chat.modelStatusRetrying,
      finalizing: DESKTOP_I18N_DICTIONARIES['zh-CN'].flowerSurface.chat.modelStatusFinalizing,
    }).toEqual({
      preparing: '正在准备模型请求...',
      waitingResponse: '正在等待模型响应...',
      streaming: '正在思考...',
      retrying: '正在重试模型请求...',
      finalizing: '正在整理回复...',
    });
    expect({
      preparing: DESKTOP_I18N_DICTIONARIES['zh-TW'].flowerSurface.chat.modelStatusPreparing,
      waitingResponse: DESKTOP_I18N_DICTIONARIES['zh-TW'].flowerSurface.chat.modelStatusWaitingResponse,
      streaming: DESKTOP_I18N_DICTIONARIES['zh-TW'].flowerSurface.chat.modelStatusStreaming,
      retrying: DESKTOP_I18N_DICTIONARIES['zh-TW'].flowerSurface.chat.modelStatusRetrying,
      finalizing: DESKTOP_I18N_DICTIONARIES['zh-TW'].flowerSurface.chat.modelStatusFinalizing,
    }).toEqual({
      preparing: '正在準備模型請求...',
      waitingResponse: '正在等待模型回應...',
      streaming: '正在思考...',
      retrying: '正在重試模型請求...',
      finalizing: '正在整理回覆...',
    });
    expect({
      preparing: DESKTOP_I18N_DICTIONARIES['es-ES'].flowerSurface.chat.modelStatusPreparing,
      waitingResponse: DESKTOP_I18N_DICTIONARIES['es-ES'].flowerSurface.chat.modelStatusWaitingResponse,
      streaming: DESKTOP_I18N_DICTIONARIES['es-ES'].flowerSurface.chat.modelStatusStreaming,
      retrying: DESKTOP_I18N_DICTIONARIES['es-ES'].flowerSurface.chat.modelStatusRetrying,
      finalizing: DESKTOP_I18N_DICTIONARIES['es-ES'].flowerSurface.chat.modelStatusFinalizing,
    }).toEqual({
      preparing: 'Preparando solicitud al modelo...',
      waitingResponse: 'Esperando respuesta del modelo...',
      streaming: 'Pensando...',
      retrying: 'Reintentando solicitud al modelo...',
      finalizing: 'Finalizando respuesta...',
    });
    expect({
      preparing: DESKTOP_I18N_DICTIONARIES['pt-BR'].flowerSurface.chat.modelStatusPreparing,
      waitingResponse: DESKTOP_I18N_DICTIONARIES['pt-BR'].flowerSurface.chat.modelStatusWaitingResponse,
      streaming: DESKTOP_I18N_DICTIONARIES['pt-BR'].flowerSurface.chat.modelStatusStreaming,
      retrying: DESKTOP_I18N_DICTIONARIES['pt-BR'].flowerSurface.chat.modelStatusRetrying,
      finalizing: DESKTOP_I18N_DICTIONARIES['pt-BR'].flowerSurface.chat.modelStatusFinalizing,
    }).toEqual({
      preparing: 'Preparando solicitação ao modelo...',
      waitingResponse: 'Aguardando resposta do modelo...',
      streaming: 'Pensando...',
      retrying: 'Tentando novamente a solicitação ao modelo...',
      finalizing: 'Finalizando resposta...',
    });
    expect(DESKTOP_I18N_DICTIONARIES['zh-CN'].flowerSurface.emptyState.explainTitle).toBe('解释代码');
    expect(DESKTOP_I18N_DICTIONARIES['zh-TW'].flowerSurface.emptyState.explainTitle).toBe('解釋程式碼');
    expect(DESKTOP_I18N_DICTIONARIES['zh-TW'].flowerSurface.threadList.refreshLabel).toBe('重新整理對話');
    expect(DESKTOP_I18N_DICTIONARIES['zh-TW'].flowerSurface.settings.backToChat).toBe('返回聊天');
    expect(DESKTOP_I18N_DICTIONARIES['zh-TW'].environmentCenter.askFlowerCardTitle).toBe('詢問 Flower');
    expect(DESKTOP_I18N_DICTIONARIES['zh-TW'].environmentCenter.askFlowerCardReplyHint).toBe('回覆 Flower');
    expect(DESKTOP_I18N_DICTIONARIES['en-US'].flowerSurface.chat.conversationsAria).toBe('Flower conversations');
    expect(DESKTOP_I18N_DICTIONARIES['en-US'].environmentCenter.askFlowerCardTitle).toBe('Ask Flower');
    expect(DESKTOP_I18N_DICTIONARIES['en-US'].environmentCenter.askFlowerLauncherQuestion).toBe('What should we look into for this Environment?');
    expect(DESKTOP_I18N_DICTIONARIES['en-US'].environmentCenter.askFlowerLauncherPlaceholder).toBe('Ask what Flower should inspect or coordinate here...');
    expect(DESKTOP_I18N_DICTIONARIES['en-US'].environmentCenter.askFlowerCardContextLabel).toBe('Linked context');
    expect(DESKTOP_I18N_DICTIONARIES['en-US'].environmentCenter.askFlowerCardReplyHint).toBe('Reply to Flower');
    expect(DESKTOP_I18N_DICTIONARIES['en-US'].environmentCenter.askFlowerWorkingDirectoryUnavailable).toBe('No working directory selected.');
    expect(DESKTOP_I18N_DICTIONARIES['en-US'].environmentCenter.askFlowerCardLaunchFailedTitle).toBe('Flower could not start this turn.');
    expect(DESKTOP_I18N_DICTIONARIES['en-US'].shell.backToEnvironments).toBe('Back to Environments');
    expect(DESKTOP_I18N_DICTIONARIES['ja-JP'].flowerSurface.threadList.title).toBe('会話');
    expect(DESKTOP_I18N_DICTIONARIES['ja-JP'].environmentCenter.askFlowerCardTitle).toBe('Flower に聞く');
    expect(DESKTOP_I18N_DICTIONARIES['fr-FR'].flowerSurface.threadList.title).toBe('Discussions');
    expect(DESKTOP_I18N_DICTIONARIES['fr-FR'].environmentCenter.askFlowerCardTitle).toBe('Demander à Flower');
    expect(DESKTOP_I18N_DICTIONARIES['ru-RU'].flowerSurface.threadList.title).toBe('Беседы');
    expect(DESKTOP_I18N_DICTIONARIES['ru-RU'].environmentCenter.askFlowerCardTitle).toBe('Спросить Flower');
  });

  it('keeps ru-RU plural messages wired for Russian plural categories', () => {
    for (const row of flattenDictionaryMessages(DESKTOP_I18N_DICTIONARIES['ru-RU'])) {
      if (!isPluralMessage(row.value)) {
        continue;
      }
      expect(row.value.forms, row.path).toHaveProperty('one');
      expect(row.value.forms, row.path).toHaveProperty('few');
      expect(row.value.forms, row.path).toHaveProperty('many');
      expect(row.value.forms, row.path).toHaveProperty('other');
    }
  });

  it('reports protected terms that are removed from translated messages', () => {
    const unsafe = {
      ...enUS,
      desktop: {
        ...enUS.desktop,
        openLocalEnvironment: 'Open local workspace',
      },
    } satisfies DesktopTranslationShape;

    expect(validateDictionaryProtectedTerms('xx-TEST', enUS, unsafe)).toContainEqual({
      locale: 'xx-TEST',
      path: 'desktop.openLocalEnvironment',
      message: 'Protected term "Local Environment" must remain unchanged.',
    });
  });

  it('keeps literal translation keys used by Desktop source files present in the base dictionary', () => {
    const sourceRoot = path.resolve(__dirname, '..', '..', 'welcome', 'flower');
    const keys = collectLiteralTranslationKeysFromSource(sourceRoot);
    const availableKeys = new Set(flattenDictionaryMessages(enUS).map((entry) => entry.path));
    const missing = [...keys.entries()]
      .filter(([key]) => !availableKeys.has(key))
      .map(([key, files]) => `${key} (${[...new Set(files)].sort().join(', ')})`)
      .sort();

    expect(missing).toEqual([]);
  });
});

describe('Desktop shared i18n helpers', () => {
  it('translates string messages and preserves missing placeholders for callers to notice', () => {
    const i18n = createDesktopI18n('zh-CN');
    expect(i18n.t('language.updatedMessage', { language: '简体中文' })).toBe('语言已更新为 简体中文。');
    expect(i18n.t('language.updatedMessage')).toBe('语言已更新为 {language}。');
    expect(i18n.t('commandPalette.changeLanguageTitle')).toBe('更改语言');
    expect(i18n.t('shell.commandSearchPlaceholder')).toBe('搜索 Desktop 命令...');
  });

  it('uses Intl.PluralRules with locale-specific forms', () => {
    const en = createDesktopI18n('en-US');
    expect(en.tn('plural.environmentCount', 1)).toBe('1 environment');
    expect(en.tn('plural.environmentCount', 2)).toBe('2 environments');

    const ru = createDesktopI18n('ru-RU');
    expect(ru.tn('plural.environmentCount', 1)).toBe('1 окружение');
    expect(ru.tn('plural.environmentCount', 2)).toBe('2 окружения');
    expect(ru.tn('plural.environmentCount', 5)).toBe('5 окружений');
  });

  it('formats dates, numbers, and relative times through Intl for the resolved locale', () => {
    const i18n = createDesktopI18n('de-DE');
    expect(i18n.formatNumber(1234.5)).toBe(new Intl.NumberFormat('de-DE').format(1234.5));
    expect(i18n.formatDateTime(new Date('2026-05-27T12:00:00Z'), { timeZone: 'UTC', dateStyle: 'medium' }))
      .toBe(new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date('2026-05-27T12:00:00Z')));
    expect(i18n.formatRelativeTime('2026-05-26T12:00:00Z', {
      now: '2026-05-27T12:00:00Z',
      unit: 'day',
      numeric: 'always',
    })).toBe(new Intl.RelativeTimeFormat('de-DE', { numeric: 'always', style: 'long' }).format(-1, 'day'));
  });
});
