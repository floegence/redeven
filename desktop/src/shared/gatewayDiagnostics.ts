const sensitiveKey = /token|secret|password|authorization|cookie|signature|private_key|proof|invitation|connect_artifact|api_key|psk/iu;

/** Redact capability material before truncation, including host command output. */
export function redactGatewayDiagnosticText(value: string): string {
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu, '[redacted]')
    .replace(/\b((?:proxy-)?authorization|cookie|set-cookie)\s*:\s*[^\r\n]+/giu, '$1: [redacted]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9_+/.=-]+/giu, '$1 [redacted]')
    .replace(/(["']?(?:[a-z0-9_-]*_)?(?:token|secret|password|signature|private_key|proof|invitation|connect_artifact|api_key|psk)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s&,;]+)/giu, '$1[redacted]');
}

export function redactGatewayDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactGatewayDiagnosticValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key,
    sensitiveKey.test(key) ? '[redacted]' : redactGatewayDiagnosticValue(nested)]));
  return typeof value === 'string' ? redactGatewayDiagnosticText(value).slice(0, 512) : value;
}
