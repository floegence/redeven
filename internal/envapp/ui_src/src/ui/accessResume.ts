const ACCESS_RESUME_HASH_KEY = 'redeven_access_resume';

function normalizeHash(rawHash: string): string {
  const hash = String(rawHash ?? '').trim();
  if (!hash || hash === '#') return '';
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

export function readAccessResumeTokenFromHash(rawHash: string): string {
  const params = new URLSearchParams(normalizeHash(rawHash));
  return String(params.get(ACCESS_RESUME_HASH_KEY) ?? '').trim();
}

export function stripAccessResumeTokenFromHash(rawHash: string): string {
  const normalized = normalizeHash(rawHash);
  if (!normalized) return '';
  const params = new URLSearchParams(normalized);
  params.delete(ACCESS_RESUME_HASH_KEY);
  const next = params.toString();
  return next ? `#${next}` : '';
}

export function consumeAccessResumeTokenFromWindow(win: Window): string {
  const token = readAccessResumeTokenFromHash(String(win.location.hash ?? ''));
  if (!token) return '';

  const nextHash = stripAccessResumeTokenFromHash(String(win.location.hash ?? ''));
  const nextURL = `${win.location.pathname}${win.location.search}${nextHash}`;
  win.history.replaceState(null, win.document.title, nextURL);
  return token;
}
