import {
  REDEVEN_I18N_PROTECTED_TERM_ALLOWLIST,
  REDEVEN_I18N_PROTECTED_TERMS,
  type RedevenI18nProtectedTerm,
  type RedevenI18nProtectedTermAllowlistEntry,
} from './protectedTerms';
import { isPluralMessage, type PluralMessage, type TranslationLeaf, type TranslationTree } from './messageTypes';
import {
  countRedevenI18nFixedEnglishTermForms,
  REDEVEN_I18N_FIXED_ENGLISH_TERM_FAMILIES,
  REDEVEN_I18N_MODEL_PROVIDER_LOCALIZED_PATH_PREFIXES,
} from './terminology';

export type DictionaryMessageRecord = Readonly<{
  path: string;
  value: TranslationLeaf;
}>;

export type DictionaryGuardIssue = Readonly<{
  locale: string;
  path: string;
  message: string;
}>;

function isTranslationLeaf(value: unknown): value is TranslationLeaf {
  return typeof value === 'string' || isPluralMessage(value);
}

function joinPath(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

export function flattenDictionaryMessages(
  dictionary: TranslationTree,
  prefix = '',
): readonly DictionaryMessageRecord[] {
  const rows: DictionaryMessageRecord[] = [];
  for (const [key, value] of Object.entries(dictionary)) {
    const path = joinPath(prefix, key);
    if (isTranslationLeaf(value)) {
      rows.push({ path, value });
      continue;
    }
    rows.push(...flattenDictionaryMessages(value, path));
  }
  return rows;
}

function placeholderSet(message: string): Set<string> {
  const placeholders = new Set<string>();
  for (const match of message.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/gu)) {
    placeholders.add(match[1] ?? '');
  }
  placeholders.delete('');
  return placeholders;
}

function formatSet(values: Set<string>): string {
  return [...values].sort().join(', ');
}

function compareSets(left: Set<string>, right: Set<string>): boolean {
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

function pluralForms(value: PluralMessage): readonly string[] {
  return Object.values(value.forms);
}

function messageStrings(value: TranslationLeaf): readonly string[] {
  return typeof value === 'string' ? [value] : pluralForms(value);
}

function sameLeafKind(left: TranslationLeaf, right: TranslationLeaf): boolean {
  return typeof left === typeof right || (isPluralMessage(left) && isPluralMessage(right));
}

function allowedProtectedTerm(
  locale: string,
  path: string,
  term: RedevenI18nProtectedTerm,
  allowlist: readonly RedevenI18nProtectedTermAllowlistEntry[],
): boolean {
  return allowlist.some((entry) => (
    (entry.locale === locale || entry.locale === '*')
    && entry.path === path
    && entry.term === term
  ));
}

function matchesPathPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(prefix));
}

export function validateDictionaryShape(
  locale: string,
  sourceDictionary: TranslationTree,
  targetDictionary: TranslationTree,
): readonly DictionaryGuardIssue[] {
  const sourceRows = flattenDictionaryMessages(sourceDictionary);
  const targetRows = new Map(flattenDictionaryMessages(targetDictionary).map((row) => [row.path, row.value]));
  const issues: DictionaryGuardIssue[] = [];

  for (const sourceRow of sourceRows) {
    const targetValue = targetRows.get(sourceRow.path);
    if (targetValue === undefined) {
      issues.push({
        locale,
        path: sourceRow.path,
        message: 'Missing translation key.',
      });
      continue;
    }
    if (!sameLeafKind(sourceRow.value, targetValue)) {
      issues.push({
        locale,
        path: sourceRow.path,
        message: 'Translation leaf kind does not match en-US.',
      });
    }
  }

  for (const targetRow of flattenDictionaryMessages(targetDictionary)) {
    if (!sourceRows.some((sourceRow) => sourceRow.path === targetRow.path)) {
      issues.push({
        locale,
        path: targetRow.path,
        message: 'Unexpected translation key.',
      });
    }
  }

  return issues;
}

export function validateDictionaryPlaceholders(
  locale: string,
  sourceDictionary: TranslationTree,
  targetDictionary: TranslationTree,
): readonly DictionaryGuardIssue[] {
  const sourceRows = flattenDictionaryMessages(sourceDictionary);
  const targetRows = new Map(flattenDictionaryMessages(targetDictionary).map((row) => [row.path, row.value]));
  const issues: DictionaryGuardIssue[] = [];

  for (const sourceRow of sourceRows) {
    const targetValue = targetRows.get(sourceRow.path);
    if (!targetRows.has(sourceRow.path) || targetValue === undefined) {
      continue;
    }

    const sourceMessages = messageStrings(sourceRow.value);
    const targetMessages = messageStrings(targetValue);
    const sourcePlaceholders = placeholderSet(sourceMessages.join('\n'));
    const targetPlaceholders = placeholderSet(targetMessages.join('\n'));
    if (!compareSets(sourcePlaceholders, targetPlaceholders)) {
      issues.push({
        locale,
        path: sourceRow.path,
        message: `Placeholder mismatch. Expected {${formatSet(sourcePlaceholders)}} but found {${formatSet(targetPlaceholders)}}.`,
      });
    }
  }

  return issues;
}

export function validateDictionaryProtectedTerms(
  locale: string,
  sourceDictionary: TranslationTree,
  targetDictionary: TranslationTree,
  allowlist = REDEVEN_I18N_PROTECTED_TERM_ALLOWLIST,
): readonly DictionaryGuardIssue[] {
  const sourceRows = flattenDictionaryMessages(sourceDictionary);
  const targetRows = new Map(flattenDictionaryMessages(targetDictionary).map((row) => [row.path, row.value]));
  const issues: DictionaryGuardIssue[] = [];

  for (const sourceRow of sourceRows) {
    const targetValue = targetRows.get(sourceRow.path);
    if (!targetRows.has(sourceRow.path) || targetValue === undefined) {
      continue;
    }

    const sourceText = messageStrings(sourceRow.value).join('\n');
    const targetText = messageStrings(targetValue).join('\n');
    for (const term of REDEVEN_I18N_PROTECTED_TERMS) {
      if (
        sourceText.includes(term)
        && !targetText.includes(term)
        && !allowedProtectedTerm(locale, sourceRow.path, term, allowlist)
      ) {
        issues.push({
          locale,
          path: sourceRow.path,
          message: `Protected term "${term}" must remain unchanged.`,
        });
      }
    }
  }

  return issues;
}

export function validateDictionaryFixedEnglishTerms(
  locale: string,
  sourceDictionary: TranslationTree,
  targetDictionary: TranslationTree,
): readonly DictionaryGuardIssue[] {
  const sourceRows = flattenDictionaryMessages(sourceDictionary);
  const targetRows = new Map(flattenDictionaryMessages(targetDictionary).map((row) => [row.path, row.value]));
  const issues: DictionaryGuardIssue[] = [];

  for (const sourceRow of sourceRows) {
    const targetValue = targetRows.get(sourceRow.path);
    if (!targetRows.has(sourceRow.path) || targetValue === undefined) {
      continue;
    }

    const sourceText = messageStrings(sourceRow.value).join('\n');
    const targetText = messageStrings(targetValue).join('\n');
    for (const family of REDEVEN_I18N_FIXED_ENGLISH_TERM_FAMILIES) {
      if (!matchesPathPrefix(sourceRow.path, family.pathPrefixes)) {
        continue;
      }
      const sourceCounts = countRedevenI18nFixedEnglishTermForms(sourceText, family);
      const targetCounts = countRedevenI18nFixedEnglishTermForms(targetText, family);
      for (const form of family.forms) {
        const expected = sourceCounts[form] ?? 0;
        const actual = targetCounts[form] ?? 0;
        if (expected !== actual) {
          issues.push({
            locale,
            path: sourceRow.path,
            message: `Fixed English term form "${form}" count mismatch. Expected ${expected} but found ${actual}.`,
          });
        }
      }
    }
  }

  return issues;
}

export function validateDictionaryLocalizedModelProviderTerms(
  locale: string,
  targetDictionary: TranslationTree,
): readonly DictionaryGuardIssue[] {
  if (locale === 'en-US') {
    return [];
  }
  const issues: DictionaryGuardIssue[] = [];

  for (const targetRow of flattenDictionaryMessages(targetDictionary)) {
    if (!matchesPathPrefix(targetRow.path, REDEVEN_I18N_MODEL_PROVIDER_LOCALIZED_PATH_PREFIXES)) {
      continue;
    }
    const targetText = messageStrings(targetRow.value).join('\n');
    for (const family of REDEVEN_I18N_FIXED_ENGLISH_TERM_FAMILIES) {
      const targetCounts = countRedevenI18nFixedEnglishTermForms(targetText, family);
      for (const form of family.forms) {
        const actual = targetCounts[form] ?? 0;
        if (actual > 0) {
          issues.push({
            locale,
            path: targetRow.path,
            message: `Model-provider term form "${form}" must be localized in this product surface.`,
          });
        }
      }
    }
  }

  return issues;
}

export function validateDesktopDictionary(
  locale: string,
  sourceDictionary: TranslationTree,
  targetDictionary: TranslationTree,
): readonly DictionaryGuardIssue[] {
  return [
    ...validateDictionaryShape(locale, sourceDictionary, targetDictionary),
    ...validateDictionaryPlaceholders(locale, sourceDictionary, targetDictionary),
    ...validateDictionaryProtectedTerms(locale, sourceDictionary, targetDictionary),
    ...validateDictionaryFixedEnglishTerms(locale, sourceDictionary, targetDictionary),
    ...validateDictionaryLocalizedModelProviderTerms(locale, targetDictionary),
  ];
}
