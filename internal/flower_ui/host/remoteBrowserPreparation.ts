type Request = <T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, signal?: AbortSignal) => Promise<T>;

// Preparation creates a fixed application entry. Host Applications retains the
// only launch, component consent, window and process lifecycle.
export function remoteBrowserPreparation(request: Request, reveal: (applicationID: string) => void) {
  return async (installationID: string, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    if (!/^browser-[a-f0-9]{24}$/u.test(installationID)) throw new Error('Browser installation unavailable');
    const application = await request<{ id: string }>('POST', '/_redeven_proxy/api/browser/extension/remote', { installation_id: installationID }, signal);
    signal.throwIfAborted();
    if (!/^custom:remote-browser-[a-f0-9]{32}\.desktop$/u.test(application.id)) throw new Error('Browser application unavailable');
    reveal(application.id);
  };
}
