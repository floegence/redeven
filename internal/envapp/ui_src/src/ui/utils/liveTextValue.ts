export type TextValueControl = HTMLTextAreaElement | HTMLInputElement;

export function readLiveTextValue(control: TextValueControl | null | undefined, fallback = ''): string {
  if (control && typeof control.value === 'string') {
    return String(control.value);
  }
  return String(fallback ?? '');
}

export function syncLiveTextValue(
  control: TextValueControl | null | undefined,
  setter: (value: string) => void,
  fallback = '',
): string {
  const next = readLiveTextValue(control, fallback);
  setter(next);
  return next;
}
