import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from 'solid-js';
import { ExternalLink, Layers, MoreHorizontal, Plus } from '@floegence/floe-webapp-core/icons';
import { Dropdown, FloatingWindow } from '@floegence/floe-webapp-core/ui';
import type { FlowerConversationParts, FlowerEmbeddedConversation } from '../../flower_ui/src/FlowerSurface';
import { FlowerIcon } from '../../flower_ui/src/icons/FlowerIcon';
import { FlowerComposerContextReference, FlowerComposerContextReferences } from '../../flower_ui/src/composer/FlowerComposerContextReferences';
import { tessivenFlowerIntent } from './flower';
import type { Selection, TessivenText } from './types';

export type CanvasFlowerRequest = {
  selection: Selection;
  labels: Record<string, string>;
  prompt?: string;
  nonce: number;
  flower_thread_id?: string;
};

export type CanvasFlowerSurfaceProps = {
  embeddedConversation: FlowerEmbeddedConversation;
  engaged: boolean;
  transcriptVisible: boolean;
};

/** Canvas placement only. Flower owns the composer, transcript and every operation. */
export function TessivenFlowerPanel(props: {
  request: CanvasFlowerRequest;
  visible: boolean;
  initialComposer?: boolean;
  t: TessivenText;
  renderSurface: (props: CanvasFlowerSurfaceProps) => JSX.Element;
  onOpenConversation: (threadID: string) => void;
  onRemoveReference: (objectRef: string) => void;
  onThreadBound?: (threadID: string) => void;
}) {
  const [boundary, setBoundary] = createSignal<HTMLDivElement>();
  const canvasID = () => props.request.selection.canvas_id;
  const [startedCanvasIDs, setStartedCanvasIDs] = createSignal<Set<string>>(
    new Set(props.initialComposer && !props.request.flower_thread_id ? [] : [canvasID()]),
  );
  const [repliesOpenByCanvas, setRepliesOpenByCanvas] = createSignal<Record<string, boolean>>({});
  const [enteringCanvasIDs, setEnteringCanvasIDs] = createSignal<Set<string>>(new Set());
  const repliesOpen = () => repliesOpenByCanvas()[canvasID()] ?? true;
  const setRepliesOpen = (open: boolean) => setRepliesOpenByCanvas(previous => ({
    ...previous,
    [canvasID()]: open,
  }));
  const initialComposer = () => props.initialComposer === true
    && !props.request.flower_thread_id
    && !startedCanvasIDs().has(canvasID());
  createEffect(on(() => props.request.nonce, nonce => {
    if (nonce && !initialComposer()) setRepliesOpen(true);
  }));
  const contextAction = createMemo(() => tessivenFlowerIntent(props.request.selection, props.t).context_action);
  const renderConversation = (parts: FlowerConversationParts) => {
    let menuAnchor: HTMLSpanElement | undefined;
    const menuItems = () => [
      { id: 'canvas-new', label: props.t('newConversation'), icon: () => <Plus /> },
      ...parts.actions().map(({ id, label, icon, disabled }) => ({ id, label, icon, disabled })),
      ...(parts.threadID() ? [
        { id: 'canvas-open-separator', label: '', separator: true },
        { id: 'canvas-open', label: props.t('flowerConversation'), icon: () => <ExternalLink /> },
      ] : []),
    ];
    return (
      <>
        <div class="tessiven-flower-output-boundary" ref={setBoundary} />
        <Show when={!initialComposer() && !repliesOpen()}>
          <button type="button" class="tessiven-flower-restore" onClick={() => setRepliesOpen(true)}
            aria-label={props.t('showReplies')}><FlowerIcon /><span>{props.t('showReplies')}</span></button>
        </Show>
        <Show when={!initialComposer()}>
          <FloatingWindow open={props.visible && repliesOpen()} onOpenChange={setRepliesOpen}
            boundary={boundary()} defaultPosition={{ x: 0, y: 0 }}
            defaultSize={{ width: 356, height: 440 }} minSize={{ width: 300, height: 260 }}
            viewportInsets={{ top: 16, right: 16, bottom: 12, left: 16 }} compactBelow={480}
            title="Flower" titleIcon={<FlowerIcon />}
            class={`tessiven-flower-output${enteringCanvasIDs().has(canvasID()) ? ' tessiven-flower-output--entering' : ''}`} zIndex={25}
            labels={{ close: props.t('hideReplies'), maximize: props.t('expandReplies'), restore: props.t('restoreReplies') }}
            headerActions={<>
              <Dropdown align="end" class="tessiven-flower-menu" triggerClass="tessiven-icon-button"
                triggerAriaLabel={props.t('replyActions')}
                trigger={<span ref={menuAnchor} class="tessiven-flower-menu-trigger"><MoreHorizontal /></span>}
                items={menuItems}
                onSelect={id => {
                  if (id === 'canvas-new') parts.newConversation();
                  else if (id === 'canvas-open') props.onOpenConversation(parts.threadID());
                  else {
                    const source = menuAnchor?.closest<HTMLElement>('button, [role="button"]');
                    if (source) parts.actions().find(action => action.id === id)?.run(source);
                  }
                }} />
              {parts.actionOverlays}
              {parts.trailingActions}
            </>}>
            <div class="tessiven-flower-chat flower-surface flower-surface-companion">
              <div class="flower-chat-main" data-flower-action-layout={parts.actionLayout()}>
                <div class="tessiven-flower-conversation">{parts.conversation}</div>
                <div class="tessiven-flower-composer">{parts.composer}</div>
              </div>
            </div>
          </FloatingWindow>
        </Show>
        <Show when={initialComposer()}>
          <div class="tessiven-flower-composer tessiven-flower-composer--initial">{parts.composer}</div>
        </Show>
      </>
    );
  };
  const embedded: FlowerEmbeddedConversation = {
    get scope() { return `tessiven:${props.request.selection.canvas_id}`; },
    get threadID() { return props.request.flower_thread_id; },
    get contextAction() { return contextAction(); },
    get request() { return props.request.nonce ? props.request : undefined; },
    onThreadBound: props.onThreadBound,
    placeholder: '',
    composerContext: <Show when={props.request.selection.object_refs.length > 0}>
      <FlowerComposerContextReferences label={props.t('flowerReference')}>
        <For each={props.request.selection.object_refs}>{objectRef => (
          <FlowerComposerContextReference label={props.request.labels[objectRef]}
            title={`${props.request.labels[objectRef]} · ${props.t('version', { version: props.request.selection.version_id })}`}
            icon={<Layers />} removeLabel={props.t('removeFlowerReference', { name: props.request.labels[objectRef] })}
            onRemove={() => props.onRemoveReference(objectRef)} />
        )}</For>
      </FlowerComposerContextReferences>
    </Show>,
    emptyContent: <div class="tessiven-flower-welcome"><FlowerIcon />
      <strong>{props.t('flowerWelcome')}</strong><p>{props.t('flowerWelcomeHint')}</p></div>,
    onSubmit: () => {
      const id = canvasID();
      setStartedCanvasIDs(previous => new Set(previous).add(id));
      setRepliesOpenByCanvas(previous => ({ ...previous, [id]: true }));
      setEnteringCanvasIDs(previous => new Set(previous).add(id));
      window.setTimeout(() => setEnteringCanvasIDs(previous => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      }), 320);
    },
    render: renderConversation,
  };
  return <div class="tessiven-flower-canvas" hidden={!props.visible} inert={!props.visible}
    data-floe-dialog-surface-host="true" data-floe-surface-portal-layer="true">
    {props.renderSurface({
      get engaged() { return props.visible; },
      get transcriptVisible() { return props.visible && repliesOpen(); },
      embeddedConversation: embedded,
    })}
  </div>;
}
