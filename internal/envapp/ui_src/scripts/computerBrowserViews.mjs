import { BrowserSession } from '@floegence/floebrowser';

// The authenticated Go Runtime owns these IDs, source grants and control tokens.
// This adapter applies that authority to the published engine; it never attaches
// a debugger, discovers a personal tab or grants a lease from a viewer message.
export async function createComputerBrowserViews(directory, options) {
  const views = new Map();
  const privateOwners = new Map();
  const audioOwners = new Map();
  let audioQueue = Promise.resolve();
  const session = await BrowserSession.open(directory, {
    authorize: () => false,
    mediaBridge: options.mediaBridge,
    resourceURL: options.resourceURL,
    onUncontrolledDialog: options.onUncontrolledDialog,
  });
  let closed = false;
  const requireView = id => {
    const view = views.get(id);
    if (!view || view.closed) throw new Error('BROWSER_VIEW_UNAVAILABLE');
    return view;
  };
  const privateOwner = target => {
    for (const id of [target, ...(options.ancestors?.(target) ?? [])]) if (privateOwners.has(id)) return privateOwners.get(id);
    return null;
  };
  const permits = (view, target) => !view.closed && view.targets.has(target)
    && (privateOwner(target) === null || privateOwner(target) === view.id);
  const refresh = () => Promise.all([...views.values()].map(view => view.connection?.refreshGrants()));
  const canHear = (view, target) => Boolean(!closed && view?.connection && view.audio && view.media && permits(view, target));
  const reconcileAudio = () => {
    // Revocation is synchronous. A queued frame from the former owner fails the
    // engine predicate before another window can receive an audio subscription.
    for (const [target, id] of audioOwners) if (!canHear(views.get(id), target)) audioOwners.delete(target);
    const work = audioQueue.then(async () => {
      await refresh();
      for (const { page } of directory.list()) {
        if (audioOwners.has(page.id)) continue;
        const owner = [...views.values()].find(view => canHear(view, page.id));
        if (owner) audioOwners.set(page.id, owner.id);
      }
      await refresh();
    });
    audioQueue = work.catch(() => {});
    return work;
  };
  const configureControl = view => view.connection.acquireControl(
    () => Boolean(view.control && permits(view, view.control.target)),
    page => Boolean(view.control && view.control.target === page.id && permits(view, page.id)),
  );

  return {
    ownsPrivacy(target) { return privateOwners.has(target); },
    isPrivate(target) { return privateOwner(target) !== null; },
    allowsAI(target, privateCommand = false) {
      return !closed && (privateOwner(target) === null || privateCommand && privateOwner(target) === '')
        && ![...views.values()].some(view => view.control?.target === target);
    },
    async open(id, targets, send, { initialTab, editable = false, ...observation } = {}) {
      if (closed || !id || views.has(id) || views.size >= 16) throw new Error('BROWSER_VIEW_UNAVAILABLE');
      const view = { id, targets: new Set(targets), editable, audio: observation.audio !== false, media: observation.media !== false, control: undefined, connection: undefined, closed: false };
      views.set(id, view);
      try {
        view.connection = await session.observe(send, {
          ...observation, initialTab, audio: true, canObserve: page => permits(view, page.id),
          canHear: page => audioOwners.get(page.id) === id && canHear(view, page.id),
        });
        if (view.closed || closed) throw new Error('BROWSER_VIEW_UNAVAILABLE');
        // Tab management is authorized separately from any page's input lease.
        view.connection.setDirectoryAuthority(editable ? () => !view.closed && view.editable : undefined);
        await reconcileAudio();
        return view.connection.currentState;
      } catch (error) {
        view.closed = true;
        views.delete(id);
        await view.connection?.close();
        throw error;
      }
    },
    state(id) { return requireView(id).connection.currentState; },
    grants(id, targets) {
      const view = requireView(id);
      view.targets = new Set(targets);
      if (view.control && !permits(view, view.control.target)) view.control = undefined;
      return Promise.all([view.connection.refreshGrants(), reconcileAudio()]);
    },
    select(id, target) {
      const view = requireView(id);
      if (!permits(view, target)) throw new Error('BROWSER_SOURCE_NOT_ALLOWED');
      return view.connection.select(target).then(() => {
        options.onSelection?.(id, target);
      });
    },
    privacy(target, id) {
      // The Runtime reserves and drains this target before granting private
      // input. Observation revocation happens before this method returns a drain.
      // Empty owner seals observation for Flower's existing private input path.
      // Only its Runtime-authorized input and fresh handback may inspect it.
      if (id !== null && id !== '' && !requireView(id).targets.has(target)) throw new Error('BROWSER_SOURCE_NOT_ALLOWED');
      if (id === null) privateOwners.delete(target);
      else privateOwners.set(target, id);
      options.privacyChanged?.();
      return Promise.all([refresh(), reconcileAudio()]);
    },
    async acquire(id, target, token) {
      const view = requireView(id);
      if (!token || !permits(view, target) || view.connection.currentState.active !== target) return false;
      const owner = options.sourceOwner(target);
      if (!owner) throw new Error('BROWSER_SOURCE_UNAVAILABLE');
      // No website or model observation is performed while changing ownership.
      await owner.setUserBrowsing(true);
      view.control = { target, token };
      const granted = await configureControl(view);
      if (!granted && view.control?.token === token) view.control = undefined;
      return granted;
    },
    async release(id, token) {
      const view = views.get(id);
      // DOM teardown and Runtime lease release can cross in transit. A closed
      // view has already drained, while a closing view retains that exact drain
      // promise, including failure. Never turn a failed cleanup into success.
      if (!view) return;
      if (view.closed) { await view.closing; return; }
      if (view.control?.token !== token) return;
      view.control = undefined;
      await view.connection.releaseControl();
    },
    directoryDecision(id, message) { return requireView(id).connection.receiveDirectoryDecision(message); },
    async receive(id, token, message) {
      const view = requireView(id);
      if (message?.type === 'command' && !message.action?.kind?.startsWith('tab_')) {
        if (!view.control || view.control.token !== token || view.control.target !== message.tab || !permits(view, message.tab)) {
          throw new Error('BROWSER_CONTROL_REVOKED');
        }
      }
      await view.connection.receive(message);
    },
    resource(id, target, resource) {
      return requireView(id).connection.readResource(target, resource);
    },
    download(id, target, download, signal) {
      return requireView(id).connection.download(target, download, signal);
    },
    upload(id, token, chooser, file, body, signal) {
      const view = requireView(id);
      if (!view.control || view.control.token !== token || !permits(view, view.control.target)) throw new Error('BROWSER_CONTROL_REVOKED');
      return view.connection.upload(chooser, file, body, signal);
    },
    media(id, enabled) {
      const view = requireView(id); view.media = enabled;
      return Promise.all([view.connection.setMedia(enabled), reconcileAudio()]);
    },
    audio(id, enabled) {
      requireView(id).audio = enabled;
      return reconcileAudio();
    },
    visible(id, visible) { return requireView(id).connection.setVisible(visible); },
    requestKeyframe(scope) { session.requestMediaKeyframe(scope); },
    async closeView(id) {
      const view = views.get(id);
      if (!view) return;
      if (view.closing) return view.closing;
      view.closed = true;
      view.control = undefined;
      view.closing = (async () => {
        // Private observation resumes only after this view's input has drained.
        // A failed drain keeps the privacy barrier instead of exposing an
        // operation whose source effects are still uncertain.
        await view.connection?.close();
        views.delete(id);
        for (const [target, owner] of privateOwners) if (owner === id) privateOwners.delete(target);
        options.privacyChanged?.();
        await refresh();
        await reconcileAudio();
      })();
      return view.closing;
    },
    async close() {
      closed = true;
      for (const view of views.values()) { view.closed = true; view.control = undefined; }
      views.clear();
      privateOwners.clear();
      audioOwners.clear();
      await session.close();
    },
  };
}
