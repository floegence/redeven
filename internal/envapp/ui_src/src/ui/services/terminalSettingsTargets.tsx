import { createContext, createSignal, useContext, type ParentProps } from 'solid-js';
import type { RedevenTerminalTransport } from './terminalTransport';

export type TerminalSettingsTarget = { kind: 'session' | 'widget'; id: string; sessionId?: string };
export function terminalSettingsResource(target: TerminalSettingsTarget): string { return JSON.stringify(target); }
export function parseTerminalSettingsResource(raw?: string): TerminalSettingsTarget | null {
  if (!raw) return null;
  try {
    const target = JSON.parse(raw);
    if (!target || !['session', 'widget'].includes(target.kind) || typeof target.id !== 'string' || !target.id.trim()
      || target.sessionId !== undefined && (target.kind !== 'widget' || typeof target.sessionId !== 'string' || !target.sessionId.trim())
      || Object.keys(target).some(key => !['kind', 'id', 'sessionId'].includes(key))) return null;
    return target;
  } catch { return null; }
}
export type TerminalSettingsAttachment = { widgetID: string | null; sessions?: () => readonly { id: string; name: string }[]; controllers: () => ReadonlyMap<string, string>; ready: () => boolean; transport: RedevenTerminalTransport };
function createAttachments() {
  const [entries, setEntries] = createSignal<readonly TerminalSettingsAttachment[]>([]);
  return { entries, register(entry: TerminalSettingsAttachment) { setEntries(old => [...old, entry]); return () => setEntries(old => old.filter(item => item !== entry)); } };
}
const TerminalSettingsAttachments = createContext<ReturnType<typeof createAttachments>>();
export const useTerminalSettingsAttachments = () => useContext(TerminalSettingsAttachments);
export function TerminalSettingsAttachmentsProvider(props: ParentProps) {
  return <TerminalSettingsAttachments.Provider value={createAttachments()}>{props.children}</TerminalSettingsAttachments.Provider>;
}

// Track published attachment/controller events; a session's creation or presence
// in a sidebar never proves that this client currently controls it.
export function trackTerminalSettingsControllers(bundle: import('./terminalTransport').RedevenTerminalLiveBundle) {
  const [controllers, setControllers] = createSignal<ReadonlyMap<string, string>>(new Map());
  const subscriptions = new Map<string, () => void>();
  let sequence = 0;
  const clear = (id: string) => setControllers(old => { const next = new Map(old); next.delete(id); return next; });
  const observe = (id: string) => {
    if (subscriptions.has(id)) return;
    const control = bundle.eventSource.onTerminalController(id, event => {
      if (!event.isController) clear(id);
      else setControllers(old => new Map(old).set(id, `${++sequence}:${event.epoch}`));
    });
    const lifecycle = bundle.eventSource.onTerminalLiveAttachmentLifecycle(id, event => { if (event.state === 'closed') clear(id); });
    subscriptions.set(id, () => { control(); lifecycle(); });
  };
  const attachWithPresentation: RedevenTerminalTransport['attachWithPresentation'] = async (id, cols, rows) => {
    observe(id); clear(id);
    // IMPORTANT: Published controller events are authoritative, including the
    // initial event. A late attach response must never resurrect revoked control.
    return bundle.transport.attachWithPresentation(id, cols, rows);
  };
  const transport: RedevenTerminalTransport = { ...bundle.transport, attachWithPresentation,
    attach: async (id, cols, rows) => { await attachWithPresentation(id, cols, rows); },
    dispose() { for (const dispose of subscriptions.values()) dispose(); subscriptions.clear(); setControllers(new Map()); bundle.transport.dispose(); },
  };
  return { transport, controllers };
}
