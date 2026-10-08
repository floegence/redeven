import { PlaywrightSourceBrowser, CDPSourcePage, ResponseDownloads, closeCDPPage } from '@floegence/floebrowser';
import { BrowserComputerController } from './computerBrowserController.mjs';

// The target helper owns one source adapter. Semantic tools and DOM projection
// borrow its root and child transports; neither creates another debugger owner.
export async function createComputerBrowserSource(page, targetID, { onPopup = () => {}, captureDownloads = false, nativeDownloads = !captureDownloads, windowViewport = false } = {}) {
  // The Runtime admits popups explicitly. A source adapter never assigns a
  // second identity or grants observation merely because a page opened it.
  const browser = new PlaywrightSourceBrowser({ onPopup, nativeDownloads, windowViewport });
  try {
    const source = await browser.adopt(page, targetID);
    return await createSourceOwner(source, () => browser.dispose(), captureDownloads);
  } catch (error) {
    await browser.dispose();
    throw error;
  }
}

// Native Messaging transports arrive already scoped to one explicitly bound
// personal tab. The Runtime owns auto-attachment and shares every iframe with
// the same semantic controller and projection adapter.
export async function createExtensionBrowserSource(transport, targetID) {
  let source, owner;
  const sessions = new Map();
  const pending = new Set();
  const autoAttach = session => session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'iframe', exclude: false }, { exclude: true }] });
  const attached = event => {
    if (event.targetInfo.type !== 'iframe') return;
    const session = transport.child(event.sessionId);
    sessions.set(event.sessionId, session);
    session.on('Target.attachedToTarget', attached);
    session.on('Target.detachedFromTarget', detached);
    const work = (async () => {
      await source.addSession(session);
      await owner.controller.page.initializeSession(session);
      await autoAttach(session);
      await session.send('Runtime.runIfWaitingForDebugger');
    })().catch(() => { if (sessions.get(event.sessionId) === session) transport.close(); });
    pending.add(work); void work.finally(() => pending.delete(work));
  };
  const detached = ({ sessionId }) => {
    const child = sessions.get(sessionId);
    if (!child) return;
    sessions.delete(sessionId);
    source.removeSession(child);
    child.emit('close');
    child.removeAllListeners();
    transport.removeChild(sessionId);
  };
  try {
    source = await CDPSourcePage.attach({ id: targetID, transport, downloads: true, close: () => closeCDPPage(source, transport) });
    owner = await createSourceOwner(source, async () => {
      transport.off('Target.attachedToTarget', attached);
      transport.off('Target.detachedFromTarget', detached);
      source.dispose();
      transport.close();
      await Promise.allSettled(pending);
      sessions.clear();
    }, true);
    transport.on('Target.attachedToTarget', attached);
    transport.on('Target.detachedFromTarget', detached);
    await autoAttach(transport);
    await Promise.allSettled(pending);
    return owner;
  } catch (error) {
    if (owner) await owner.dispose();
    else { source?.dispose(); transport.close(); }
    throw error;
  }
}

async function createSourceOwner(source, disposeSource, captureDownloads) {
  const transport = source.transport;
  // OOP frame transports precede the root so the semantic reader attributes
  // each frame to the process that owns its actual execution context.
  transport.frameSessions = async () => [...source.sessions()].reverse();
  const downloads = captureDownloads ? new ResponseDownloads(download => {
    source.reportDownload(download);
    const changed = () => {
      const state = download.state;
      if (controller.page.downloads.size >= 32 && !controller.page.downloads.has(state.id)) controller.page.downloads.delete(controller.page.downloads.keys().next().value);
      controller.page.downloads.set(state.id, { id: state.id, filename: state.filename, state: state.status === 'receiving' ? 'in_progress' : state.status === 'complete' ? 'completed' : state.status, ...(state.size === undefined ? {} : { size_bytes: state.size }) });
      controller.page.changed();
    };
    download.subscribe(changed); changed();
  }) : undefined;
  const controller = new BrowserComputerController(transport, { responseDownloads: downloads });

  const attached = session => {
    void controller.page.initializeSession(session).catch(() => {
      if (source.sessions().includes(session)) controller.close();
    });
  };
  const detached = session => controller.page.releaseSession(session);
  const closed = () => controller.close();
  source.on('sessionattached', attached);
  source.on('sessiondetached', detached);
  source.on('close', closed);
  try {
    await downloads?.observe(source, () => source.emit('downloadunavailable'));
    await Promise.all(source.sessions().map(session => controller.page.initializeSession(session)));
  }
  catch (error) {
    source.off('sessionattached', attached); source.off('sessiondetached', detached); source.off('close', closed);
    controller.close();
    for (const session of controller.page.sessions.keys()) controller.page.releaseSession(session);
    await downloads?.close();
    throw error;
  }
  let disposed = false;
  let disposal;
  return {
    source,
    controller,
    async setUserBrowsing(active) {
      if (disposed) throw new Error('TARGET_CONNECTION_REQUIRED');
      // Called only by the trusted Runtime after draining the target gate.
      // Closing a viewer does not turn background source traffic into AI work.
      if (controller.page.userBrowsing !== active) {
        controller.page.userBrowsing = active;
        controller.cancel();
        await controller.page.releaseInput();
        await controller.page.releasePage();
      }
      if (active && transport.tabId !== undefined && !controller.page.focusedSessions.has(transport)) {
        // Prepare background input before granting viewer control. The shared
        // focus owner releases this override before private computer input.
        await transport.send('Emulation.setFocusEmulationEnabled', { enabled: true });
        controller.page.focusedSessions.add(transport);
      }
    },
    async prepareRecoveryObservation() {
      if (disposed) throw new Error('TARGET_CONNECTION_REQUIRED');
      controller.page.handback();
      await this.setUserBrowsing(false);
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      source.off('sessionattached', attached);
      source.off('sessiondetached', detached);
      source.off('close', closed);
      controller.cancel();
      disposal = (async () => {
        try { await controller.page.releaseInput(); }
        finally {
          await controller.page.releasePage();
          controller.close();
          try { await downloads?.close(); }
          finally {
            // Fetch interception stays enabled until its debugger detaches.
            // Keep the policy listener alive while pending navigation drains.
            try { await disposeSource(); }
            finally { for (const session of controller.page.sessions.keys()) controller.page.releaseSession(session); }
          }
        }
      })();
      return disposal;
    },
  };
}
