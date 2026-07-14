export const REDEVEN_I18N_PROTECTED_TERMS = [
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

export type RedevenI18nProtectedTerm = (typeof REDEVEN_I18N_PROTECTED_TERMS)[number];

export type RedevenI18nProtectedTermAllowlistEntry = Readonly<{
  locale: string | '*';
  path: string;
  term: RedevenI18nProtectedTerm;
  reason: string;
}>;

export const REDEVEN_I18N_PROTECTED_TERM_ALLOWLIST: readonly RedevenI18nProtectedTermAllowlistEntry[] = [];
