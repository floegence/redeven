type SandboxWindowInfo = Readonly<{
  origin: string;
  floe_app: string;
  code_space_id: string;
  app_path: string;
}>;

const opened = new Map<Window, SandboxWindowInfo>();

export function registerSandboxWindow(win: Window, info: SandboxWindowInfo): void {
  if (!win) return;
  opened.set(win, info);
}

export function getSandboxWindowInfo(source: MessageEventSource | null): SandboxWindowInfo | null {
  if (!source) return null;
  // In practice we only support Window openers. We intentionally avoid responding to other sources.
  const w = source as Window;
  if (typeof (w as any).postMessage !== 'function') return null;
  const info = opened.get(w);
  if (!info) return null;
  if ((w as any).closed) {
    opened.delete(w);
    return null;
  }
  return info;
}
