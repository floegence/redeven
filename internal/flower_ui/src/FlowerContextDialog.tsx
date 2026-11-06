import { createUniqueId, type JSX } from 'solid-js';
import { Dialog, type DialogProps } from '@floegence/floe-webapp-core/ui';
import { FlowerContextSource } from './FlowerContextSource';

/** Bind the entire portalled dialog without reading arbitrary form values. */
export function FlowerContextDialog(props: DialogProps): JSX.Element {
  const id = createUniqueId();
  return <Dialog {...props}>
    <FlowerContextSource id={`dialog:${id}`} pageID={`dialog:${id}`}
      pageName={typeof props.title === 'string' ? props.title : ''}
      mode="overlay" selected={props.open} enabled={props.open && typeof props.title === 'string'} class="contents"
      boundary={body => body.closest<HTMLElement>('[role="dialog"]') ?? body}>
      {props.children}
    </FlowerContextSource>
  </Dialog>;
}
