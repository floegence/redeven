import { Show, createEffect, createMemo, createResource, createSignal, onCleanup, type Component } from 'solid-js';
import {
  Button,
  ChatInput,
  ChatProvider,
  LoadingOverlay,
  VirtualMessageList,
  useChatContext,
  useNotification,
  type Attachment,
  type ChatCallbacks,
  type ChatContextValue,
  type Message,
  type StreamEvent,
} from '@floegence/floe-webapp-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useEnvContext } from './EnvContext';

type ModelsResponse = Readonly<{
  default_model: string;
  models: Array<{ id: string; label?: string }>;
}>;

type RunHistoryMsg = Readonly<{ role: 'user' | 'assistant'; text: string }>;

async function fetchGatewayJSON<T>(url: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const resp = await fetch(url, { ...init, headers, credentials: 'omit', cache: 'no-store' });
  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }
  if (!resp.ok) throw new Error(data?.error ?? `HTTP ${resp.status}`);
  if (data?.ok === false) throw new Error(String(data?.error ?? 'Request failed'));
  return (data?.data ?? data) as T;
}

function createUserMarkdownMessage(markdown: string): Message {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    blocks: [{ type: 'markdown', content: markdown }],
    status: 'complete',
    timestamp: Date.now(),
  };
}

const ChatCapture: Component<{ onReady: (ctx: ChatContextValue) => void }> = (props) => {
  const ctx = useChatContext();
  createEffect(() => props.onReady(ctx));
  return null;
};

export function EnvAIPage() {
  const env = useEnvContext();
  const protocol = useProtocol();
  const notify = useNotification();

  const [models] = createResource(async () => {
    return await fetchGatewayJSON<ModelsResponse>('/_redeven_proxy/api/ai/models', { method: 'GET' });
  });

  const [selectedModel, setSelectedModel] = createSignal('');
  const [history, setHistory] = createSignal<RunHistoryMsg[]>([]);

  const [runId, setRunId] = createSignal<string | null>(null);
  const [running, setRunning] = createSignal(false);

  let chat: ChatContextValue | null = null;
  const [chatReady, setChatReady] = createSignal(false);

  let abortCtrl: AbortController | null = null;
  let assistantText = '';

  const modelsReady = createMemo(() => !!models() && !models.loading && !models.error);
  const canInteract = createMemo(() => protocol.status() === 'connected' && !running() && modelsReady());

  createEffect(() => {
    const m = models();
    if (!m) return;
    const current = selectedModel().trim();
    if (!current && m.default_model) {
      setSelectedModel(m.default_model);
    }
  });

  // FileBrowser -> AI context injection.
  let lastInjectionSeq = 0;
  createEffect(() => {
    if (!chatReady()) return;
    const seq = env.aiInjectionSeq();
    if (!seq || seq === lastInjectionSeq) return;
    lastInjectionSeq = seq;

    const md = env.aiInjectionMarkdown();
    if (!md || !md.trim()) return;

    chat?.addMessage(createUserMarkdownMessage(md));
    setHistory((prev) => [...prev, { role: 'user', text: md }]);
  });

  const uploadAttachment = async (file: File): Promise<string> => {
    const form = new FormData();
    form.append('file', file);

    const resp = await fetch('/_redeven_proxy/api/ai/uploads', {
      method: 'POST',
      body: form,
      credentials: 'omit',
      cache: 'no-store',
    });

    const text = await resp.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }
    if (!resp.ok) throw new Error(data?.error ?? `HTTP ${resp.status}`);
    if (data?.ok === false) throw new Error(String(data?.error ?? 'Upload failed'));

    const url = String(data?.data?.url ?? '').trim();
    if (!url) throw new Error('Upload failed');
    return url;
  };

  const sendToolApproval = async (_messageId: string, toolId: string, approved: boolean) => {
    const id = runId();
    if (!id) return;
    await fetchGatewayJSON<void>(`/_redeven_proxy/api/ai/runs/${encodeURIComponent(id)}/tool_approvals`, {
      method: 'POST',
      body: JSON.stringify({ tool_id: toolId, approved }),
    });
  };

  const cancel = async () => {
    const id = runId();
    abortCtrl?.abort();
    abortCtrl = null;
    setRunning(false);
    setRunId(null);
    try {
      if (!id) return;
      await fetchGatewayJSON<void>(`/_redeven_proxy/api/ai/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    } catch {
      // best-effort
    }
  };

  const handleStreamEvent = (ev: StreamEvent) => {
    chat?.handleStreamEvent(ev);

    if (ev.type === 'block-delta' && typeof (ev as any).delta === 'string') {
      assistantText += String((ev as any).delta);
      return;
    }
    if (ev.type === 'message-end') {
      const text = assistantText.trim();
      assistantText = '';
      if (text) {
        setHistory((prev) => [...prev, { role: 'assistant', text }]);
      }
      setRunning(false);
      setRunId(null);
      abortCtrl = null;
      return;
    }
    if (ev.type === 'error') {
      const msg = String((ev as any).error ?? 'AI error');
      notify.error('AI failed', msg);
      setRunning(false);
      setRunId(null);
      abortCtrl = null;
      return;
    }
  };

  const startRun = async (content: string, attachments: Attachment[]) => {
    if (!chat) {
      notify.error('AI unavailable', 'Chat is not ready.');
      return;
    }
    if (running()) {
      notify.info('AI is busy', 'Please wait for the current run to finish.');
      return;
    }
    if (models.error) {
      const msg = models.error instanceof Error ? models.error.message : String(models.error);
      notify.error('AI unavailable', msg || 'Failed to load models.');
      return;
    }
    const model = selectedModel().trim();
    if (!model) {
      notify.error('Missing model', 'Please select a model.');
      return;
    }

    const uploaded = attachments.filter((a) => a.status === 'uploaded' && !!String(a.url ?? '').trim());
    const attIn = uploaded.map((a) => ({
      name: a.file.name,
      mime_type: a.file.type,
      url: String(a.url ?? '').trim(),
    }));

    assistantText = '';
    setRunning(true);

    const historySnapshot = history();

    // Record user text into the history (attachments are excluded by contract).
    const userText = String(content ?? '').trim();
    if (userText) setHistory((prev) => [...prev, { role: 'user', text: userText }]);

    const ac = new AbortController();
    abortCtrl = ac;

    try {
      const body = JSON.stringify({
        model,
        history: historySnapshot,
        input: { text: userText, attachments: attIn },
        options: { max_steps: 10 },
      });

      const resp = await fetch('/_redeven_proxy/api/ai/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: ac.signal,
        credentials: 'omit',
        cache: 'no-store',
      });

      if (!resp.ok) {
        const raw = await resp.text();
        let msg = raw;
        try {
          const data = raw ? JSON.parse(raw) : null;
          msg = String(data?.error ?? data?.message ?? raw);
        } catch {
          // ignore
        }
        throw new Error(msg || `HTTP ${resp.status}`);
      }

      const rid = String(resp.headers.get('X-Redeven-AI-Run-ID') ?? '').trim();
      if (rid) setRunId(rid);

      const stream = resp.body;
      if (!stream) throw new Error('Missing response body');

      const reader = stream.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        for (;;) {
          const idx = buffer.indexOf('\n');
          if (idx < 0) break;
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          try {
            handleStreamEvent(JSON.parse(line) as StreamEvent);
          } catch {
            // ignore invalid frames
          }
        }
      }

      // If the stream ended without a terminal event, mark the current message as errored to avoid a stuck UI.
      if (running()) {
        const streamingMessageId = chat.streamingMessageId?.() ?? null;
        if (streamingMessageId) {
          chat.handleStreamEvent({ type: 'error', messageId: streamingMessageId, error: 'AI connection closed.' } as any);
        }
        setRunning(false);
        setRunId(null);
        abortCtrl = null;
      }
    } catch (e) {
      // Abort is a normal control flow when the user clicks "Stop".
      if (e && typeof e === 'object' && (e as any).name === 'AbortError') {
        setRunning(false);
        setRunId(null);
        abortCtrl = null;
        return;
      }

      const msg = e instanceof Error ? e.message : String(e);
      notify.error('AI failed', msg || 'Request failed.');
      setRunning(false);
      setRunId(null);
      abortCtrl = null;
    }
  };

  const callbacks: ChatCallbacks = {
    onSendMessage: async (content, attachments, _addMessage) => {
      if (protocol.status() !== 'connected') {
        notify.error('Not connected', 'Connecting to agent...');
        return;
      }
      await startRun(content, attachments);
    },
    onUploadAttachment: uploadAttachment,
    onToolApproval: sendToolApproval,
  };

  onCleanup(() => {
    abortCtrl?.abort();
    abortCtrl = null;
  });

  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <ChatProvider
        config={{
          placeholder: 'Describe what you want to do...',
          allowAttachments: true,
          maxAttachments: 5,
          maxAttachmentSize: 10 * 1024 * 1024,
        }}
        callbacks={callbacks}
      >
        <ChatCapture
          onReady={(ctx) => {
            chat = ctx;
            setChatReady(true);
          }}
        />

        <div class="chat-container h-full">
          <div class="chat-header">
            <div class="chat-header-title">AI</div>
            <div class="flex items-center gap-2">
              <select
                class="text-xs border border-border rounded px-2 py-1 bg-background max-w-[280px]"
                value={selectedModel()}
                onChange={(e) => setSelectedModel(e.currentTarget.value)}
                disabled={models.loading || !!models.error || running()}
              >
                <Show when={models()}>
                  {(m) => (
                    <>
                      {m().models.map((it) => (
                        <option value={it.id}>{it.label ?? it.id}</option>
                      ))}
                    </>
                  )}
                </Show>
              </select>

              <Show when={running()}>
                <Button size="sm" variant="secondary" onClick={() => void cancel()}>
                  Stop
                </Button>
              </Show>
            </div>
          </div>

          <Show when={models.error}>
            <div class="px-3 py-2 text-xs border-b border-border text-muted-foreground">
              <div class="font-medium text-foreground">AI is not available.</div>
              <div class="mt-1">
                Configure the <code class="px-1 py-0.5 bg-muted rounded">ai</code> section in{' '}
                <code class="px-1 py-0.5 bg-muted rounded">~/.redeven-agent/config.json</code> and restart the agent.
              </div>
              <div class="mt-1">Error: {models.error instanceof Error ? models.error.message : String(models.error)}</div>
            </div>
          </Show>

          <VirtualMessageList class="chat-container-messages" />

          <ChatInput
            class="chat-container-input"
            disabled={!canInteract()}
            placeholder="Type a message..."
          />
        </div>
      </ChatProvider>

      <LoadingOverlay visible={protocol.status() !== 'connected'} message="Connecting to agent..." />
      <LoadingOverlay visible={models.loading} message="Loading models..." />
    </div>
  );
}
