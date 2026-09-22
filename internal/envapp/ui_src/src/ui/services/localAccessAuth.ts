const LOCAL_ACCESS_RESUME_HEADER = 'X-Redeven-Access-Resume';


let localAccessResumeToken = '';

export function getLocalAccessResumeHeaderName(): string {
  return LOCAL_ACCESS_RESUME_HEADER;
}

export function readLocalAccessResumeToken(): string {
  return String(localAccessResumeToken ?? '').trim();
}

export function writeLocalAccessResumeToken(token: string): void {
  localAccessResumeToken = String(token ?? '').trim();
}

export function clearLocalAccessResumeToken(): void {
  localAccessResumeToken = '';
}

export function applyLocalAccessResumeHeader(headers: Headers): void {
  const token = readLocalAccessResumeToken();
  if (!token) return;
  headers.set(LOCAL_ACCESS_RESUME_HEADER, token);
}
