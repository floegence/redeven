import { Show, createEffect, createMemo, createResource, createSignal, onCleanup, type Component } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import { Settings, Sparkles, Stop } from '@floegence/floe-webapp-core/icons';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button, Select, Tooltip } from '@floegence/floe-webapp-core/ui';
import {
  ChatInput,
  ChatProvider,
  VirtualMessageList,
  useChatContext,
  type Attachment,
  type ChatCallbacks,
  type ChatContextValue,
  type Message,
  type StreamEvent,
} from '@floegence/floe-webapp-core/chat';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { useEnvContext } from './EnvContext';

import { fetchGatewayJSON } from '../services/gatewayApi';

type ModelsResponse = Readonly<{
  default_model: string;
  models: Array<{ id: string; label?: string }>;
}>;

type RunHistoryMsg = Readonly<{ role: 'user' | 'assistant'; text: string }>;

type SettingsResponse = Readonly<{
  ai: any | null;
}>;

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

  const settingsKey = createMemo<number | null>(() => (protocol.status() === 'connected' ? env.settingsSeq() : null));
  const [settings] = createResource<SettingsResponse | null, number | null>(
    () => settingsKey(),
    async (k) => (k == null ? null : await fetchGatewayJSON<SettingsResponse>('/_redeven_proxy/api/settings', { method: 'GET' })),
  );
  const aiEnabled = createMemo(() => !!settings()?.ai);

  const modelsKey = createMemo<number | null>(() => {
    if (settingsKey() == null) return null;
    if (!aiEnabled()) return null;
    return env.settingsSeq();
  });

  const [models] = createResource<ModelsResponse | null, number | null>(
    () => modelsKey(),
    async (k) => (k == null ? null : await fetchGatewayJSON<ModelsResponse>('/_redeven_proxy/api/ai/models', { method: 'GET' })),
  );

  const [selectedModel, setSelectedModel] = createSignal('');
  const [history, setHistory] = createSignal<RunHistoryMsg[]>([]);

  const [runId, setRunId] = createSignal<string | null>(null);
  const [running, setRunning] = createSignal(false);

  let chat: ChatContextValue | null = null;
  const [chatReady, setChatReady] = createSignal(false);

  let abortCtrl: AbortController | null = null;
  let assistantText = '';

  const modelsReady = createMemo(() => !!models() && !models.loading && !models.error);
  const canInteract = createMemo(() => protocol.status() === 'connected' && !running() && aiEnabled() && modelsReady());

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
    if (!aiEnabled()) {
      notify.error('AI not configured', 'Open Settings to enable AI.');
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

  // Select options derived from models
  const modelOptions = createMemo(() => {
    const m = models();
    if (!m) return [];
    return m.models.map((it) => ({
      value: it.id,
      label: it.label ?? it.id,
    }));
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
          {/* Header */}
          <div class="chat-header">
            <div class="chat-header-title flex items-center gap-2">
              <Sparkles class="w-4 h-4 text-primary" />
              <span>AI Assistant</span>
            </div>
            <div class="flex items-center gap-1.5">
              {/* Model selector */}
              <Show when={aiEnabled() && modelOptions().length > 0}>
                <Select
                  value={selectedModel()}
                  onChange={setSelectedModel}
                  options={modelOptions()}
                  placeholder="Select model..."
                  disabled={models.loading || !!models.error || running()}
                  class="min-w-[140px] max-w-[220px] h-7 text-[11px]"
                />
              </Show>

              {/* Stop button */}
              <Show when={running()}>
                <Tooltip content="Stop generation" placement="bottom" delay={0}>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={Stop}
                    onClick={() => void cancel()}
                    class="h-7 px-2 text-error border-error/30 hover:bg-error/10 hover:text-error"
                  >
                    Stop
                  </Button>
                </Tooltip>
              </Show>

              {/* Settings button */}
              <Tooltip content="AI Settings" placement="bottom" delay={0}>
                <Button
                  size="icon"
                  variant="ghost"
                  icon={Settings}
                  onClick={() => env.openSettings('ai')}
                  aria-label="Settings"
                  class="w-7 h-7"
                />
              </Tooltip>
            </div>
          </div>

          {/* Error banner: Settings unavailable */}
          <Show when={settings.error}>
            <div class="px-4 py-3 text-xs border-b border-border bg-error/5">
              <div class="flex items-center gap-2 font-medium text-error">
                <span class="w-1.5 h-1.5 rounded-full bg-error" />
                Settings are not available
              </div>
              <div class="mt-1 text-muted-foreground">
                {settings.error instanceof Error ? settings.error.message : String(settings.error)}
              </div>
            </div>
          </Show>

          {/* Empty state: AI not configured */}
          <Show when={settings() && !aiEnabled() && !settings.error && !settings.loading}>
            <div class="flex flex-col items-center justify-center flex-1 p-8 text-center">
              <div class="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Sparkles class="w-8 h-8 text-primary" />
              </div>
              <div class="text-base font-semibold text-foreground mb-2">AI is not configured</div>
              <div class="text-xs text-muted-foreground mb-4 max-w-[280px]">
                Configure an AI provider in settings to start using the AI assistant.
              </div>
              <Button size="sm" variant="default" onClick={() => env.openSettings('ai')}>
                Open Settings
              </Button>
            </div>
          </Show>

          {/* Error banner: Models unavailable */}
          <Show when={models.error && aiEnabled()}>
            <div class="px-4 py-3 text-xs border-b border-border bg-error/5">
              <div class="flex items-center gap-2 font-medium text-error">
                <span class="w-1.5 h-1.5 rounded-full bg-error" />
                AI is not available
              </div>
              <div class="mt-1 text-muted-foreground">
                {models.error instanceof Error ? models.error.message : String(models.error)}
              </div>
            </div>
          </Show>

          {/* Message list - only show when AI is enabled and no empty state */}
          <Show when={aiEnabled() || settings.loading}>
            <VirtualMessageList class="chat-container-messages" />
          </Show>

          {/* Input area */}
          <ChatInput
            class="chat-container-input"
            disabled={!canInteract()}
            placeholder={aiEnabled() ? 'Type a message...' : 'Configure AI in settings to start...'}
          />
        </div>
      </ChatProvider>

      <LoadingOverlay visible={protocol.status() !== 'connected'} message="Connecting to agent..." />
      <LoadingOverlay visible={settings.loading && protocol.status() === 'connected'} message="Loading settings..." />
      <LoadingOverlay visible={models.loading && aiEnabled()} message="Loading models..." />
    </div>
  );
}
