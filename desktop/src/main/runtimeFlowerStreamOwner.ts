import type { Event, WebContents } from 'electron';

/** Runtime streams belong to the renderer document that opened them. */
export function bindRuntimeFlowerStreamOwner(
  sender: Pick<WebContents, 'on' | 'removeListener'>,
  cancel: () => void,
): () => void {
  let active = true;
  const release = () => {
    if (!active) return;
    active = false;
    sender.removeListener('destroyed', close);
    sender.removeListener('render-process-gone', close);
    sender.removeListener('did-start-navigation', navigate);
  };
  const close = () => {
    if (!active) return;
    release();
    cancel();
  };
  const navigate = (_event: Event, _url: string, inPlace: boolean, mainFrame: boolean) => {
    if (mainFrame && !inPlace) close();
  };
  sender.on('destroyed', close);
  sender.on('render-process-gone', close);
  sender.on('did-start-navigation', navigate);
  return release;
}
