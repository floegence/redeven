import type { PluralMessage, RichTextPart } from './dictionaryTypes';
import type { EnvAppTranslationShape } from './locales';

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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRichTextPart(value: unknown): value is RichTextPart {
  return isRecord(value) && typeof value.type === 'string';
}

function isPluralMessage(value: unknown): value is PluralMessage {
  return isRecord(value) && typeof value.other === 'string';
}

function collectRichTextStrings(parts: readonly unknown[]): string {
  const messages: string[] = [];
  for (const part of parts) {
    if (!isRichTextPart(part)) {
      continue;
    }
    if (part.type === 'text' || part.type === 'code' || part.type === 'kbd') {
      messages.push(part.value);
      continue;
    }
    if (part.type === 'strong' || part.type === 'link') {
      messages.push(collectRichTextStrings(part.children));
    }
  }
  return messages.filter(Boolean).join('\n');
}

function collectStringLeaves(value: unknown, prefix = ''): Readonly<Record<string, string>> {
  if (typeof value === 'string') {
    return { [prefix]: value };
  }

  if (Array.isArray(value)) {
    return { [prefix]: collectRichTextStrings(value) };
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
    Object.assign(entries, collectStringLeaves(child, prefix ? `${prefix}.${key}` : key));
  }
  return entries;
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
