import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from './storageKey';

export {
  matchRedevenLocaleCandidate,
  normalizeRedevenLocale,
  normalizeRedevenLocalePreference,
  normalizeRedevenSystemCandidates,
  normalizeSystemLocaleCandidates,
  resolveRedevenLanguageSnapshot,
  resolveRedevenLocale,
  resolveRedevenLocaleFromCandidates,
  sameRedevenLanguageSnapshot,
  type RedevenLanguageSnapshot,
  type RedevenLanguageSnapshotSource,
  type RedevenLocaleResolutionSource,
} from './resolveLocale';
export type { RedevenLocalePreference } from './localeMeta';

export const REDEVEN_LANGUAGE_PREFERENCE_STATE_KEY = REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY;
