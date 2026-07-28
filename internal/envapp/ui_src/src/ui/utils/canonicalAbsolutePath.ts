export function canonicalAbsolutePath(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim() || !value.startsWith('/')) return '';
  const containsControl = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (value.includes('\\') || containsControl) return '';
  if (value === '/') return value;
  if (value.endsWith('/')) return '';
  const segments = value.slice(1).split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return value;
}
