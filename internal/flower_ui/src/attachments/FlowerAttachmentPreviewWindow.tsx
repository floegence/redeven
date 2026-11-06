import { SandboxedHtmlFrame } from '@floegence/floe-webapp-core/html-preview';
import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import type { Component } from 'solid-js';
import type { FlowerTaskFilePreviewContentProps } from '../FlowerTaskFilePreview';
import { For, on, lazy, Suspense, Match, Show, Switch, createEffect, createMemo, createSignal, createUniqueId, onCleanup } from 'solid-js';
import { isRichFilePreview } from '../preview/previewKinds';
import type { TaskFilesCopy } from '../taskFilesCopy';
const FlowerRichFilePreview = lazy(() => import('../preview/FlowerRichFilePreview').then(module => ({ default: module.FlowerRichFilePreview })));
import { cn } from '@floegence/floe-webapp-core';
import { Button, FloatingWindow, RetainedPanel, WindowTabs } from '@floegence/floe-webapp-core/ui';

export type FlowerAttachmentPreviewSource = Readonly<{
  id: string;
  name: string;
  mimeType: string;
  load: (signal: AbortSignal) => Promise<Blob>;
}>;

type FlowerAttachmentPreviewWindowProps = Readonly<{
  source: FlowerAttachmentPreviewSource | null;
  renderContent?: Component<FlowerTaskFilePreviewContentProps>;
  copy: TaskFilesCopy;
  zIndex?: number;
  loadingLabel: string;
  unavailableLabel: string;
  onClose: () => void;
}>;

function currentViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1440, height: 900 };
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(320, window.innerHeight),
  };
}

function resolveSizing(viewport: { width: number; height: number }) {
  const margin = viewport.width < 640 ? 8 : 12;
  const maxWidth = Math.max(280, viewport.width - margin * 2);
  const maxHeight = Math.max(280, viewport.height - margin * 2);
  return {
    defaultSize: { width: Math.min(860, maxWidth), height: Math.min(680, maxHeight) },
    minSize: { width: Math.min(340, maxWidth), height: Math.min(280, maxHeight) },
  };
}

function mimeEssence(value: string): string {
  return value.trim().toLowerCase().split(';', 1)[0] ?? '';
}

function previewKind(mimeType: string, name = ''): 'image' | 'pdf' | 'text' | 'html' | 'unsupported' {
  const essence = mimeEssence(mimeType);
  if (/\.(html?|xhtml)$/i.test(name) || essence === 'text/html' || essence === 'application/xhtml+xml') return 'html';
  if (essence.startsWith('image/')) return 'image';
  if (essence === 'application/pdf') return 'pdf';
  if (essence === 'text/plain' || essence === 'text/markdown') return 'text';
  return 'unsupported';
}

const AttachmentPreviewPanel: Component<FlowerAttachmentPreviewWindowProps & { source: FlowerAttachmentPreviewSource; open: boolean; active: boolean }> = (props) => {
  const [loading, setLoading] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  const [error, setError] = createSignal('');
  const [resolvedMimeType, setResolvedMimeType] = createSignal('');
  const [objectURL, setObjectURL] = createSignal('');
  const [text, setText] = createSignal('');
  const [blob, setBlob] = createSignal<Blob>();
  let activeObjectURL = '';
  let loadingController: AbortController | undefined;
  createEffect(() => { if (!props.open) loadingController?.abort(); });

  const clearContent = () => {
    if (activeObjectURL) URL.revokeObjectURL(activeObjectURL);
    activeObjectURL = '';
    setObjectURL('');
    setText('');
    setBlob(undefined);
    setResolvedMimeType('');
    setError('');
  };

  createEffect(() => {
    const source = props.source;
    revision();
    clearContent();
    if (!source) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    loadingController = controller;
    setLoading(true);
    void source.load(controller.signal).then(async (blob) => {
      if (controller.signal.aborted) return;
      const mimeType = mimeEssence(blob.type) || mimeEssence(source.mimeType);
      if (previewKind(mimeType, source.name) === 'html' && blob.size > 2 * 1024 * 1024) throw new Error(props.unavailableLabel);
      setResolvedMimeType(mimeType);
      setBlob(blob);
      if ((previewKind(mimeType, source.name) === 'text' || previewKind(mimeType, source.name) === 'html') && !isRichFilePreview(source.name)) {
        const content = await blob.text();
        if (controller.signal.aborted) return;
        setText(content);
      } else if (previewKind(mimeType, source.name) === 'image' || previewKind(mimeType, source.name) === 'pdf') {
        activeObjectURL = URL.createObjectURL(blob);
        setObjectURL(activeObjectURL);
      }
    }).catch((reason) => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : props.unavailableLabel);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    onCleanup(() => controller.abort());
  });

  onCleanup(clearContent);

  const kind = createMemo(() => previewKind(resolvedMimeType() || props.source?.mimeType || '', props.source.name));

  return (
        <div class="flower-attachment-preview-surface">
          <Show when={!loading()} fallback={<div class="flower-attachment-preview-state">{props.loadingLabel}</div>}>
            <Show when={!error()} fallback={<div class="flower-attachment-preview-state flower-attachment-preview-error flex-col" role="alert"><span>{error()}</span><Button size="sm" variant="ghost" disabled={!props.open} onClick={() => setRevision(value => value + 1)}>{props.copy.retry}</Button></div>}>
              <Switch fallback={(
                <div class="flower-attachment-preview-state">
                  <FileItemIcon size={40} item={{ name: props.source.name, type: 'file' }} class="size-10 shrink-0" />
                  <span>{props.unavailableLabel}</span>
                </div>
              )}>
                <Match when={props.renderContent && blob() && (isRichFilePreview(props.source.name) || kind() === 'html')}>
                  <Show when={props.renderContent}>{Content => { const Renderer = Content(); return <Renderer active={props.active} name={props.source.name} mime={resolvedMimeType()} blob={blob()!} />; }}</Show>
                </Match>
                <Match when={blob() && isRichFilePreview(props.source.name)}>
                  <Suspense fallback={<div class="flower-attachment-preview-state">{props.loadingLabel}</div>}><FlowerRichFilePreview name={props.source.name} mime={resolvedMimeType()} blob={blob()!} copy={props.copy} /></Suspense>
                </Match>
                <Match when={kind() === 'image' && objectURL()}>
                  <img class="flower-attachment-preview-image" src={objectURL()} alt={props.source.name} />
                </Match>
                <Match when={kind() === 'pdf' && objectURL()}>
                  <object class="flower-attachment-preview-document" data={objectURL()} type="application/pdf">
                    <div class="flower-attachment-preview-state">{props.unavailableLabel}</div>
                  </object>
                </Match>
                <Match when={kind() === 'html'}>
                  <SandboxedHtmlFrame class="flower-task-preview-html" html={text()} title={props.source.name} active={props.active}
                    renderPending={() => <span class="flower-attachment-preview-state" role="status">{props.loadingLabel}</span>}
                    labels={{ linkUnavailable: props.unavailableLabel, anchorUnavailable: props.unavailableLabel }} />
                </Match>
                <Match when={kind() === 'text'}>
                  <pre class="flower-attachment-preview-text">{text()}</pre>
                </Match>
              </Switch>
            </Show>
          </Show>
        </div>

  );
};


export const FlowerAttachmentPreviewWindow: Component<FlowerAttachmentPreviewWindowProps> = (props) => {
  const sizing = resolveSizing(currentViewportSize());
  const tabPrefix = createUniqueId();
  const tabId = (id: string) => tabPrefix + '-tab-' + encodeURIComponent(id);
  const panelId = (id: string) => tabPrefix + '-panel-' + encodeURIComponent(id);
  const [sources, setSources] = createSignal<FlowerAttachmentPreviewSource[]>([]);
  const [activeId, setActiveId] = createSignal('');
  const active = () => sources().find(source => source.id === activeId());
  let closing = false;
  createEffect(on(() => props.source, source => {
    if (!source) { closing = true; return; }
    if (closing) { setSources([]); closing = false; }
    setSources(current => current.some(item => item.id === source.id) ? current : [...current, source]);
    setActiveId(source.id);
  }));
  const closeTab = (id: string) => {
    const current = sources();
    if (current.length === 1) { props.onClose(); return; }
    const remaining = current.filter(source => source.id !== id);
    if (id === activeId()) setActiveId(remaining[Math.min(current.findIndex(source => source.id === id), remaining.length - 1)].id);
    setSources(remaining);
    if (remaining.length === 1) queueMicrotask(() => {
      if (document.activeElement === document.body) document.getElementById(panelId(remaining[0].id))?.focus({ preventScroll: true });
    });
  };
  // Keep DOM order independent from tab order so embedded viewers never reload.
  const panels = createMemo<FlowerAttachmentPreviewSource[]>(previous => {
    const current = sources();
    return [...previous.filter(source => current.includes(source)), ...current.filter(source => !previous.includes(source))];
  }, []);
  const RetainedPanels = () => {
    onCleanup(() => { if (!props.source) setSources([]); });
    return <div class="relative h-full min-h-0 flex-1"><For each={panels()}>{source => <RetainedPanel active={activeId() === source.id} class="h-full min-h-0" data-attachment-preview-document={source.id}
      tabIndex={-1} role={sources().length > 1 ? 'tabpanel' : undefined} id={panelId(source.id)} aria-labelledby={sources().length > 1 ? tabId(source.id) : undefined} aria-label={source.name}
      >
      <AttachmentPreviewPanel {...props} source={source} open={!!props.source} active={activeId() === source.id && !!props.source} />
    </RetainedPanel>}</For></div>;
  };
  const multiple = createMemo(() => sources().length > 1);
  const tabItems = createMemo(() => sources().map(source => ({ id: source.id, domId: tabId(source.id), panelId: panelId(source.id), label: source.name, title: source.name,
        closeLabel: props.copy.close + ' ' + source.name, closable: true,
        icon: <FileItemIcon size={14} item={{ name: source.name, type: 'file' }} class="size-3.5" />,
      })));
  return <FloatingWindow open={!!props.source} onOpenChange={open => { if (!open) props.onClose(); }} title={active()?.name}
    titleContent={multiple() ? <WindowTabs ariaLabel={props.copy.preview}
      items={tabItems()} activeId={activeId()} onChange={setActiveId} onReorder={ids => setSources(current => ids.map(id => current.find(source => source.id === id)!))} onClose={closeTab}
      labels={{ scrollLeft: props.copy.previousTab, scrollRight: props.copy.nextTab }} /> : undefined}
    class={cn('flower-attachment-preview-window', 'shadow-[0_28px_72px_-42px_var(--redeven-shadow-color)]')}
    defaultSize={sizing.defaultSize} minSize={sizing.minSize} resizable draggable zIndex={props.zIndex ?? 164}>
    <RetainedPanels />
  </FloatingWindow>;
};
