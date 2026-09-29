import { contextBridge, ipcRenderer } from 'electron';
import {
  SESSION_RESTART_INIT, SESSION_RESTART_REGISTER, SESSION_RESTART_PREPARE, SESSION_RESTART_CANCEL,
  SESSION_RESTART_SUBMIT, SESSION_RESTART_READ, SESSION_RESTART_RESTORED,
  type SessionRestartBridge, type SessionRestartState,
} from '../shared/sessionRestartIPC';

export function bootstrapSessionRestartBridge(): void {
  const generation: unknown = ipcRenderer.sendSync(SESSION_RESTART_INIT);
  if (typeof generation !== 'string' || !generation) return;
  let prepare: (() => Promise<SessionRestartState>) | undefined;
  let cancel: (() => void) | undefined;
  let currentTicket = '';
  ipcRenderer.on(SESSION_RESTART_PREPARE, (_event, ticket: string) => {
    if (!prepare || currentTicket || typeof ticket !== 'string') return;
    currentTicket = ticket;
    void prepare().then(async state => {
      if (currentTicket !== ticket) return;
      const accepted = await ipcRenderer.invoke(SESSION_RESTART_SUBMIT, { generation, ticket, state });
      if (!accepted && currentTicket === ticket) { currentTicket = ''; cancel?.(); }
    }).catch(async () => {
      if (currentTicket !== ticket) return;
      currentTicket = '';
      cancel?.();
      await ipcRenderer.invoke(SESSION_RESTART_SUBMIT, { generation, ticket, state: null });
    });
  });
  ipcRenderer.on(SESSION_RESTART_CANCEL, (_event, ticket: string) => {
    if (currentTicket !== ticket) return;
    currentTicket = '';
    cancel?.();
  });
  const bridge: SessionRestartBridge = {
    register: (nextPrepare, nextCancel) => {
      if (prepare) throw new Error('The Env App already owns Runtime restart preparation.');
      prepare = nextPrepare;
      cancel = nextCancel;
      ipcRenderer.send(SESSION_RESTART_REGISTER, generation);
      return () => { prepare = undefined; cancel = undefined; };
    },
    read: () => ipcRenderer.invoke(SESSION_RESTART_READ, generation),
    restored: (ticket) => ipcRenderer.invoke(SESSION_RESTART_RESTORED, { generation, ticket }),
  };
  contextBridge.exposeInMainWorld('redevenDesktopSessionRestart', bridge);
}
