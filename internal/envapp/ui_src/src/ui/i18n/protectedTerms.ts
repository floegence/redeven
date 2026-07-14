import type { PluralMessage, RichTextPart } from './dictionaryTypes';
import type { EnvAppTranslationShape } from './locales';
import {
  countFixedEnglishTermForms,
  FIXED_ENGLISH_TERM_FAMILIES,
  MODEL_PROVIDER_LOCALIZED_PATH_PREFIXES,
} from './terminology';

export const PROTECTED_TERMS = [
  'Redeven',
  'Redeven Desktop',
  'Flower',
  'Codex',
  'Env App',
  'Codespaces',
  'Browser Editor',
  'E2EE',
  'Flowersec',
  'Local UI',
  'ReDevPlugin',
  'Activity',
  'Workbench',
] as const;

export type ProtectedTerm = typeof PROTECTED_TERMS[number];

export type ProtectedTermViolation = Readonly<{
  key: string;
  locale: string;
  term: ProtectedTerm;
}>;

export type FixedEnglishTermViolation = Readonly<{
  key: string;
  locale: string;
  canonical: string;
  form: string;
  expectedCount: number;
  actualCount: number;
}>;

export type LocalizedModelProviderTermViolation = Readonly<{
  key: string;
  locale: string;
  form: string;
  actualCount: number;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRichTextPart(value: unknown): value is RichTextPart {
  return isRecord(value) && typeof value.type === 'string';
}

function isPluralMessage(value: unknown): value is PluralMessage {
  return isRecord(value) && typeof value.other === 'string';
}

function collectRichTextStrings(parts: readonly unknown[], includeCode: boolean): string {
  const messages: string[] = [];
  for (const part of parts) {
    if (!isRichTextPart(part)) {
      continue;
    }
    if (part.type === 'text' || ((part.type === 'code' || part.type === 'kbd') && includeCode)) {
      messages.push(part.value);
      continue;
    }
    if (part.type === 'strong' || part.type === 'link') {
      messages.push(collectRichTextStrings(part.children, includeCode));
    }
  }
  return messages.filter(Boolean).join('\n');
}

function collectStringLeaves(
  value: unknown,
  prefix = '',
  options: Readonly<{ includeRichTextCode: boolean }> = { includeRichTextCode: true },
): Readonly<Record<string, string>> {
  if (typeof value === 'string') {
    return { [prefix]: value };
  }

  if (Array.isArray(value)) {
    return { [prefix]: collectRichTextStrings(value, options.includeRichTextCode) };
  }

  if (!isRecord(value)) {
    return {};
  }

  if (isPluralMessage(value)) {
    return {
      [prefix]: Object.values(value)
        .filter((message): message is string => typeof message === 'string')
        .join('\n'),
    };
  }

  const entries: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    Object.assign(entries, collectStringLeaves(child, prefix ? `${prefix}.${key}` : key, options));
  }
  return entries;
}

function matchesPathPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(prefix));
}

export function findProtectedTermViolations(
  source: EnvAppTranslationShape,
  target: EnvAppTranslationShape,
  locale: string,
): ProtectedTermViolation[] {
  const sourceLeaves = collectStringLeaves(source);
  const targetLeaves = collectStringLeaves(target);
  const violations: ProtectedTermViolation[] = [];

  for (const [key, sourceValue] of Object.entries(sourceLeaves)) {
    const targetValue = targetLeaves[key] ?? '';
    for (const term of PROTECTED_TERMS) {
      if (sourceValue.includes(term) && !targetValue.includes(term)) {
        violations.push({ key, locale, term });
      }
    }
  }

  return violations;
}

export function findFixedEnglishTermViolations(
  source: EnvAppTranslationShape,
  target: EnvAppTranslationShape,
  locale: string,
): FixedEnglishTermViolation[] {
  const sourceLeaves = collectStringLeaves(source, '', { includeRichTextCode: false });
  const targetLeaves = collectStringLeaves(target, '', { includeRichTextCode: false });
  const violations: FixedEnglishTermViolation[] = [];

  for (const [key, sourceValue] of Object.entries(sourceLeaves)) {
    const targetValue = targetLeaves[key] ?? '';
    for (const family of FIXED_ENGLISH_TERM_FAMILIES) {
      if (!matchesPathPrefix(key, family.pathPrefixes)) {
        continue;
      }
      const sourceCounts = countFixedEnglishTermForms(sourceValue, family);
      const targetCounts = countFixedEnglishTermForms(targetValue, family);
      for (const form of family.forms) {
        const expectedCount = sourceCounts[form] ?? 0;
        const actualCount = targetCounts[form] ?? 0;
        if (expectedCount !== actualCount) {
          violations.push({
            key,
            locale,
            canonical: family.canonical,
            form,
            expectedCount,
            actualCount,
          });
        }
      }
    }
  }

  return violations;
}

export function findLocalizedModelProviderTermViolations(
  target: EnvAppTranslationShape,
  locale: string,
): LocalizedModelProviderTermViolation[] {
  const targetLeaves = collectStringLeaves(target, '', { includeRichTextCode: false });
  const violations: LocalizedModelProviderTermViolation[] = [];

  for (const [key, targetValue] of Object.entries(targetLeaves)) {
    if (!matchesPathPrefix(key, MODEL_PROVIDER_LOCALIZED_PATH_PREFIXES)) {
      continue;
    }
    for (const family of FIXED_ENGLISH_TERM_FAMILIES) {
      const targetCounts = countFixedEnglishTermForms(targetValue, family);
      for (const form of family.forms) {
        const actualCount = targetCounts[form] ?? 0;
        if (actualCount > 0) {
          violations.push({ key, locale, form, actualCount });
        }
      }
    }
  }

  return violations;
}
