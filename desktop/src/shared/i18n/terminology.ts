import type { RedevenLocale } from './localeMeta';

export const REDEVEN_I18N_FORBIDDEN_GENERIC_ENGLISH_TERMS = [
  'Runtime',
  'Workspace',
  'Environment',
  'Files',
  'Local Environment',
  'Control Plane',
] as const;

export type RedevenI18nFixedEnglishTermFamily = Readonly<{
  canonical: string;
  forms: readonly string[];
  pathPrefixes: readonly string[];
  reason: string;
}>;

export const REDEVEN_I18N_FIXED_ENGLISH_TERM_FAMILIES = [
  {
    canonical: 'Provider',
    forms: ['Provider', 'Providers', 'provider', 'providers'],
    pathPrefixes: [
      'desktop.',
      'issue.',
      'environmentCenter.',
      'providerRuntimeLink.',
      'environmentStatus.',
      'environmentAction.',
      'environmentFacts.',
      'toast.',
      'progress.',
      'runtimeMessage.',
      'connectionDialog.',
      'confirm.',
    ],
    reason: 'Fixed Redeven domain term used for remote-environment and control-plane surfaces.',
  },
] as const satisfies readonly RedevenI18nFixedEnglishTermFamily[];

export const REDEVEN_I18N_MODEL_PROVIDER_LOCALIZED_PATH_PREFIXES = [
  'flowerSurface.',
] as const;

function terminologyComparableText(text: string): string {
  return text
    .replace(/`[^`]*`/gu, ' ')
    .replace(/\{[^}]+\}/gu, ' ')
    .replace(/(?:https?|wss?):\/\/[^\s)]+/gu, ' ');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function countRedevenI18nFixedEnglishTermForms(
  text: string,
  family: RedevenI18nFixedEnglishTermFamily,
): Readonly<Record<string, number>> {
  const counts = Object.fromEntries(family.forms.map((form) => [form, 0])) as Record<string, number>;
  const comparableText = terminologyComparableText(text);
  const alternatives = [...family.forms]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|');
  const formPattern = new RegExp(`(?<![A-Za-z_])(?:${alternatives})(?![A-Za-z_])`, 'gu');
  for (const match of comparableText.matchAll(formPattern)) {
    const form = match[0];
    if (comparableText.slice((match.index ?? 0) + form.length).startsWith('[]')) {
      continue;
    }
    if (Object.hasOwn(counts, form)) {
      counts[form] = (counts[form] ?? 0) + 1;
    }
  }
  return counts;
}

export const REDEVEN_I18N_TECHNICAL_TERM_ALLOWLIST = [
  { term: 'API', reason: 'Standard developer-facing protocol acronym.' },
  { term: 'RPC', reason: 'Standard developer-facing protocol acronym.' },
  { term: 'SSH', reason: 'Standard secure-shell protocol name.' },
  { term: 'URL', reason: 'Standard address acronym used in technical fields.' },
  { term: 'JSON', reason: 'Standard data-format name.' },
  { term: 'ID', reason: 'Standard identifier abbreviation.' },
  { term: 'PID', reason: 'Standard process identifier abbreviation.' },
  { term: 'Git', reason: 'Product and version-control system name.' },
  { term: 'HTTP', reason: 'Standard web protocol name.' },
  { term: 'HTTPS', reason: 'Standard web protocol name.' },
  { term: 'WebSocket', reason: 'Standard web transport name.' },
  { term: 'WASM', reason: 'Standard WebAssembly abbreviation.' },
  { term: 'PDF', reason: 'Standard document-format name.' },
  { term: 'DOCX', reason: 'Standard document-format extension.' },
  { term: 'XLSX', reason: 'Standard spreadsheet-format extension.' },
  { term: 'CSV', reason: 'Standard tabular-format extension.' },
  { term: 'Markdown', reason: 'Standard markup-format name.' },
  { term: 'Linux', reason: 'Operating-system name used in platform diagnostics.' },
  { term: 'amd64', reason: 'Standard CPU architecture identifier.' },
  { term: 'arm64', reason: 'Standard CPU architecture identifier.' },
  { term: 'glibc', reason: 'Standard Linux C library name.' },
] as const;

export type RedevenLocaleTerminology = Readonly<{
  files: string;
  terminal: string;
  session: string;
  conversation: string;
  workspace: string;
  environment: string;
  modelProvider: string;
  permission: string;
  approval: string;
  preview: string;
  copy: string;
  duplicate: string;
}>;

export const REDEVEN_I18N_LOCALE_TERMINOLOGY: Readonly<Record<Exclude<RedevenLocale, 'en-US'>, RedevenLocaleTerminology>> = {
  'zh-CN': { files: '文件', terminal: '终端', session: '会话', conversation: '对话', workspace: '工作区', environment: '环境', modelProvider: '模型提供商', permission: '权限', approval: '审批', preview: '预览', copy: '复制', duplicate: '创建副本' },
  'zh-TW': { files: '檔案', terminal: '終端', session: '工作階段', conversation: '對話', workspace: '工作區', environment: '環境', modelProvider: '模型供應商', permission: '權限', approval: '核准', preview: '預覽', copy: '複製', duplicate: '建立副本' },
  'ja-JP': { files: 'ファイル', terminal: 'ターミナル', session: 'セッション', conversation: '会話', workspace: 'ワークスペース', environment: '環境', modelProvider: 'モデルプロバイダー', permission: '権限', approval: '承認', preview: 'プレビュー', copy: 'コピー', duplicate: '複製' },
  'ko-KR': { files: '파일', terminal: '터미널', session: '세션', conversation: '대화', workspace: '작업 공간', environment: '환경', modelProvider: '모델 제공업체', permission: '권한', approval: '승인', preview: '미리보기', copy: '복사', duplicate: '사본 만들기' },
  'de-DE': { files: 'Dateien', terminal: 'Terminal', session: 'Sitzung', conversation: 'Unterhaltung', workspace: 'Arbeitsbereich', environment: 'Umgebung', modelProvider: 'Modellanbieter', permission: 'Berechtigung', approval: 'Bestätigung', preview: 'Vorschau', copy: 'Kopieren', duplicate: 'Duplizieren' },
  'fr-FR': { files: 'Fichiers', terminal: 'Terminal', session: 'session', conversation: 'conversation', workspace: 'espace de travail', environment: 'environnement', modelProvider: 'fournisseur de modèles', permission: 'autorisation', approval: 'approbation', preview: 'aperçu', copy: 'copier', duplicate: 'dupliquer' },
  'es-ES': { files: 'Archivos', terminal: 'Terminal', session: 'sesión', conversation: 'conversación', workspace: 'espacio de trabajo', environment: 'entorno', modelProvider: 'proveedor de modelos', permission: 'permiso', approval: 'aprobación', preview: 'vista previa', copy: 'copiar', duplicate: 'duplicar' },
  'pt-BR': { files: 'Arquivos', terminal: 'Terminal', session: 'sessão', conversation: 'conversa', workspace: 'área de trabalho', environment: 'ambiente', modelProvider: 'provedor de modelos', permission: 'permissão', approval: 'aprovação', preview: 'prévia', copy: 'copiar', duplicate: 'duplicar' },
  'ru-RU': { files: 'Файлы', terminal: 'Терминал', session: 'сеанс', conversation: 'беседа', workspace: 'рабочая область', environment: 'окружение', modelProvider: 'поставщик моделей', permission: 'разрешение', approval: 'подтверждение', preview: 'предварительный просмотр', copy: 'копировать', duplicate: 'создать копию' },
};

export const REDEVEN_I18N_ZH_TW_FORBIDDEN_SIMPLIFIED_CHARACTERS = '这为发后里么个与门开关见览复务体进过还从无现将应类级仅启则处时实问载设线别确许组数选达边导创删击图广录补临协权术稳运连换';
