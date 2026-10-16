import { createMemo, For, Show, type Accessor, type JSX } from 'solid-js';
import type { FlowerRenderableMessageBlock } from '../flowerTimelineProjection';

type Props = Readonly<{
  blocks: readonly FlowerRenderableMessageBlock[];
  renderBlock: (block: Accessor<FlowerRenderableMessageBlock>) => JSX.Element;
  references: JSX.Element;
  hasReferences: boolean;
}>;

/** Presentation only: canonical block and reference order stay unchanged. */
export function FlowerUserMessageBody(props: Props) {
  const blocksByKey = createMemo(() => new Map(props.blocks.map(block => [block.key, block])));
  const imageKeys = createMemo(() => props.blocks.filter(block => block.type === 'image').map(block => block.key));
  const fileKeys = createMemo(() => props.blocks.filter(block => block.type === 'file').map(block => block.key));
  const bodyKeys = createMemo(() => props.blocks.filter(block => block.type !== 'image' && block.type !== 'file'
    && (block.type !== 'content' || block.content.trim().length > 0)).map(block => block.key));
  const render = (key: string) => {
    const block = createMemo(() => blocksByKey().get(key));
    return <Show when={block()}>{props.renderBlock}</Show>;
  };
  return <>
    <Show when={imageKeys().length > 0}>
      <div class="flower-message-images"><For each={imageKeys()}>{render}</For></div>
    </Show>
    <Show when={fileKeys().length > 0 || props.hasReferences}>
      <div class="flower-message-resources">
        <For each={fileKeys()}>{render}</For>
        {props.references}
      </div>
    </Show>
    <For each={bodyKeys()}>{render}</For>
  </>;
}
