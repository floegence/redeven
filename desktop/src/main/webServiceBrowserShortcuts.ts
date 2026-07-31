export type WebServiceBrowserInput = Readonly<{
  type: string;
  key: string;
  code?: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}>;

export function isWebServiceBrowserDevToolsShortcut(input: WebServiceBrowserInput): boolean {
  if (input.type !== 'keyDown') return false;
  const key = input.key.trim().toLowerCase();
  const code = String(input.code ?? '').trim().toLowerCase();
  if ((key === 'f12' || code === 'f12') && !input.control && !input.shift && !input.alt && !input.meta) {
    return true;
  }
  if (key !== 'i' && code !== 'keyi') return false;
  if (input.meta && input.alt && !input.control && !input.shift) return true;
  return input.control && input.shift && !input.meta && !input.alt;
}
