export const REDEVEN_I18N_PROTECTED_TERMS = [
  'Redeven',
  'Flower',
  'Codex',
  'Desktop',
  'Local Environment',
  'Env App',
  'Workbench',
  'Codespaces',
  'Browser Editor',
  'Runtime',
  'Control Plane',
  'E2EE',
  'Flowersec',
  'Local UI',
  'Web Services',
  'Provider',
] as const;

export type RedevenI18nProtectedTerm = (typeof REDEVEN_I18N_PROTECTED_TERMS)[number];

export type RedevenI18nProtectedTermAllowlistEntry = Readonly<{
  locale: string;
  path: string;
  term: RedevenI18nProtectedTerm;
  reason: string;
}>;

export const REDEVEN_I18N_PROTECTED_TERM_ALLOWLIST: readonly RedevenI18nProtectedTermAllowlistEntry[] = [];
