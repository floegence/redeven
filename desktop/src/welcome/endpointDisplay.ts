function truncateMiddle(value: string, maxLength: number, headRatio = 0.5): string {
  if (value.length <= maxLength || maxLength <= 0) {
    return value;
  }
  if (maxLength === 1) {
    return '…';
  }
  if (maxLength === 2) {
    return `${value.slice(0, 1)}…`;
  }

  const visible = maxLength - 1;
  const head = Math.min(visible - 1, Math.max(1, Math.ceil(visible * headRatio)));
  const tail = visible - head;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

export function endpointDisplayValue(value: string): string {
  const clean = String(value ?? '').trim();
  if (!clean) {
    return '';
  }

  try {
    const url = new URL(clean);
    const display = `${url.host}${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
    return truncateMiddle(display, 42, 0.68);
  } catch {
    return truncateMiddle(clean, 42);
  }
}
