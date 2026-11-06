import type { JSX } from 'solid-js';
import { ContextMenuActions, type ContextMenuRequest, type ContextMenuEditingLabels } from '@floegence/floe-webapp-core/ui';
import { FlowerContextMenuIcon } from './icons/FlowerSoftAuraIcon';

export function GlobalFlowerContextMenu(props: {
  enabled?: boolean;
  label: string;
  editingLabels: ContextMenuEditingLabels;
  onError: (error: unknown) => void;
  prepare: (request: ContextMenuRequest) => () => void;
  children: JSX.Element;
}) {
  return <ContextMenuActions enabled={props.enabled} label={props.label} zIndex={5100}
    editing={{ labels: props.editingLabels, onError: props.onError }}
    actions={request => [{ id: 'assistant.ask.flower', label: props.label,
      icon: () => <FlowerContextMenuIcon />, onSelect: props.prepare(request) }]}>
    {props.children}
  </ContextMenuActions>;
}
