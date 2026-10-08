import { Show, createEffect, createMemo, createSignal, on, type JSX } from 'solid-js';
import { ExternalLink, Layers, Plus } from '@floegence/floe-webapp-core/icons';
import { FloatingWindow } from '@floegence/floe-webapp-core/ui';
import type { FlowerConversationParts, FlowerEmbeddedConversation } from '../../flower_ui/src/FlowerSurface';
import { FlowerIcon } from '../../flower_ui/src/icons/FlowerIcon';
import { FlowerComposerContextReference, FlowerComposerContextReferences } from '../../flower_ui/src/composer/FlowerComposerContextReferences';
import { tessivenFlowerIntent } from './flower';
import type { Selection, TessivenText } from './types';

export type CanvasFlowerRequest = {
  selection: Selection;
  label: string;
  prompt?: string;
  nonce: number;
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
  t: TessivenText;
  renderSurface: (props: CanvasFlowerSurfaceProps) => JSX.Element;
  onOpenConversation: (threadID: string) => void;
}) {
  const [repliesOpen, setRepliesOpen] = createSignal(true);
  const [boundary, setBoundary] = createSignal<HTMLDivElement>();
  createEffect(on(() => props.request.nonce, nonce => { if (nonce) setRepliesOpen(true); }));
  const contextAction = createMemo(() => tessivenFlowerIntent(props.request.selection, props.t).context_action);
  const renderConversation = (parts: FlowerConversationParts) => <>
    <div class="tessiven-flower-output-boundary" ref={setBoundary} />
    <Show when={!repliesOpen()}>
      <button type="button" class="tessiven-flower-restore" onClick={() => setRepliesOpen(true)}
        aria-label={props.t('showReplies')}><FlowerIcon /><span>{props.t('showReplies')}</span></button>
    </Show>
    <FloatingWindow open={props.visible && repliesOpen()} onOpenChange={setRepliesOpen}
      boundary={boundary()} defaultPosition={{ x: 0, y: 0 }}
      defaultSize={{ width: 400, height: 440 }} minSize={{ width: 300, height: 220 }}
      viewportInsets={{ top: 16, right: 16, bottom: 12, left: 16 }} compactBelow={480}
      title="Flower" class="tessiven-flower-output" zIndex={25}
      labels={{ close: props.t('hideReplies'), maximize: props.t('expandReplies'), restore: props.t('restoreReplies') }}
      headerActions={<>
        {parts.actions}
        <button type="button" class="tessiven-icon-button" onClick={parts.newConversation}
          title={props.t('newConversation')} aria-label={props.t('newConversation')}><Plus /></button>
        <Show when={parts.threadID()}><button type="button" class="tessiven-icon-button"
          title={props.t('flowerConversation')} aria-label={props.t('flowerConversation')}
          onClick={() => props.onOpenConversation(parts.threadID())}><ExternalLink /></button></Show>
      </>}>
      <div class="tessiven-flower-conversation flower-surface flower-surface-companion">{parts.conversation}</div>
    </FloatingWindow>
    <div class="tessiven-flower-composer">{parts.composer}</div>
  </>;
  const embedded: FlowerEmbeddedConversation = {
    get scope() { return `tessiven:${props.request.selection.canvas_id}`; },
    get contextAction() { return contextAction(); },
    get request() { return props.request.nonce ? props.request : undefined; },
    placeholder: '',
    composerContext: <FlowerComposerContextReferences label={props.t('flowerReference')}>
      <FlowerComposerContextReference label={props.request.label}
        title={`${props.request.label} · ${props.t('version', { version: props.request.selection.version_id })}`}
        icon={<Layers />} />
    </FlowerComposerContextReferences>,
    emptyContent: <div class="tessiven-flower-welcome"><FlowerIcon />
      <strong>{props.t('flowerWelcome')}</strong><p>{props.t('flowerWelcomeHint')}</p></div>,
    onSubmit: () => setRepliesOpen(true),
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
