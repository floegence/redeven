import {
  REDEVEN_DEFAULT_LOCALE,
  REDEVEN_SUPPORTED_LOCALES,
  SYSTEM_LOCALE_PREFERENCE,
  isRedevenLocale,
  type RedevenLocale,
  type RedevenLocalePreference,
} from './localeMeta';

export type RedevenLocaleResolutionSource = 'explicit' | 'system' | 'fallback';
export type RedevenLanguageSnapshotSource = RedevenLocaleResolutionSource;

export type RedevenLanguageSnapshot = Readonly<{
  preference: RedevenLocalePreference;
  resolved_locale: RedevenLocale;
  source: RedevenLanguageSnapshotSource;
  system_candidates: readonly string[];
}>;

const SUPPORTED_LOCALE_BY_LOWERCASE = new Map<string, RedevenLocale>(
  REDEVEN_SUPPORTED_LOCALES.map((locale) => [locale.toLowerCase(), locale]),
);

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeCandidateTag(value: unknown): string {
  return compact(value).replace(/_/gu, '-').toLowerCase();
}

export function normalizeRedevenLocale(value: unknown): RedevenLocale | '' {
  const candidate = compact(value);
  return isRedevenLocale(candidate) ? candidate : '';
}

export function normalizeRedevenLocalePreference(
  value: unknown,
  fallback: RedevenLocalePreference = SYSTEM_LOCALE_PREFERENCE,
): RedevenLocalePreference {
  const candidate = compact(value);
  if (candidate === SYSTEM_LOCALE_PREFERENCE) {
    return SYSTEM_LOCALE_PREFERENCE;
  }
  return SUPPORTED_LOCALE_BY_LOWERCASE.get(candidate.toLowerCase()) ?? fallback;
}

export function normalizeRedevenSystemCandidates(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const raw of value) {
    const candidate = compact(raw);
    if (!candidate) {
      continue;
    }
    const identity = normalizeCandidateTag(candidate);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    candidates.push(candidate);
  }
  return candidates;
}

export function normalizeSystemLocaleCandidates(candidates: readonly unknown[]): readonly string[] {
  return normalizeRedevenSystemCandidates([...candidates]);
}

export function matchRedevenLocaleCandidate(candidate: unknown): RedevenLocale | null {
  const normalized = normalizeCandidateTag(candidate);
  if (!normalized) {
    return null;
  }

  const exact = SUPPORTED_LOCALE_BY_LOWERCASE.get(normalized);
  if (exact) {
    return exact;
  }

  const parts = normalized.split('-').filter(Boolean);
  const language = parts[0] ?? '';
  if (!/^[a-z]{2,3}$/u.test(language)) {
    return null;
  }

  if (language === 'zh') {
    if (parts.includes('hant') || parts.includes('tw') || parts.includes('hk') || parts.includes('mo')) {
      return 'zh-TW';
    }
    return 'zh-CN';
  }

  switch (language) {
    case 'en':
      return 'en-US';
    case 'ja':
      return 'ja-JP';
    case 'ko':
      return 'ko-KR';
    case 'de':
      return 'de-DE';
    case 'fr':
      return 'fr-FR';
    case 'es':
      return 'es-ES';
    case 'pt':
      return 'pt-BR';
    case 'ru':
      return 'ru-RU';
    default:
      return null;
  }
}

export function resolveRedevenLocaleFromCandidates(
  candidates: readonly unknown[],
): Readonly<{
  locale: RedevenLocale;
  source: Extract<RedevenLanguageSnapshotSource, 'system' | 'fallback'>;
}> {
  for (const candidate of candidates) {
    const locale = matchRedevenLocaleCandidate(candidate);
    if (locale) {
      return { locale, source: 'system' };
    }
  }

  return { locale: REDEVEN_DEFAULT_LOCALE, source: 'fallback' };
}

export function resolveRedevenLanguageSnapshot(
  preference: RedevenLocalePreference,
  systemCandidates: readonly unknown[] = [],
): RedevenLanguageSnapshot {
  const normalizedPreference = normalizeRedevenLocalePreference(preference);
  const normalizedCandidates = normalizeSystemLocaleCandidates(systemCandidates);

  if (normalizedPreference !== SYSTEM_LOCALE_PREFERENCE) {
    return {
      preference: normalizedPreference,
      resolved_locale: normalizedPreference,
      source: 'explicit',
      system_candidates: normalizedCandidates,
    };
  }

  const resolved = resolveRedevenLocaleFromCandidates(normalizedCandidates);
  return {
    preference: normalizedPreference,
    resolved_locale: resolved.locale,
    source: resolved.source,
    system_candidates: normalizedCandidates,
  };
}

export function resolveRedevenLocale(
  storedPreference: unknown,
  systemCandidates: readonly unknown[] = [],
): RedevenLanguageSnapshot {
  const preference = normalizeRedevenLocalePreference(storedPreference);
  const normalizedCandidates = normalizeSystemLocaleCandidates(systemCandidates);
  if (preference !== SYSTEM_LOCALE_PREFERENCE) {
    return {
      preference,
      resolved_locale: preference,
      source: 'explicit',
      system_candidates: normalizedCandidates,
    };
  }

  const resolved = resolveRedevenLocaleFromCandidates(normalizedCandidates);
  return {
    preference,
    resolved_locale: resolved.locale,
    source: resolved.source,
    system_candidates: normalizedCandidates,
  };
}

export function sameRedevenLanguageSnapshot(
  left: RedevenLanguageSnapshot,
  right: RedevenLanguageSnapshot,
): boolean {
  return left.preference === right.preference
    && left.resolved_locale === right.resolved_locale
    && left.source === right.source
    && left.system_candidates.length === right.system_candidates.length
    && left.system_candidates.every((candidate, index) => candidate === right.system_candidates[index]);
}
