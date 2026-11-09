import { children, createContext, createEffect, onCleanup, Show, useContext, type JSX } from 'solid-js';
import { Button, SettingsList } from '@floegence/floe-webapp-core/ui';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import './settings-resources.css';

/** Product resource navigation is projected into the one retained dialog header. */
export const SettingsResourceHeaderContext = createContext<(content: JSX.Element) => () => void>();

export function SettingsResourceHeader(props: { active: boolean; children: JSX.Element }) {
  const publish = useContext(SettingsResourceHeaderContext);
  const content = children(() => props.children);
  // IMPORTANT: Only the presented exact resource may own the header. Retained
  // editors never duplicate popup owners or leave hidden actionable controls.
  createEffect(() => {
    if (publish && props.active) onCleanup(publish(content()));
  });
  return <Show when={!publish && props.active}><div class="settings-resource-header">{content()}</div></Show>;
}

export function SettingsResourceList(props: { label: string; children: JSX.Element }) {
  return <SettingsList class="settings-resource-list" data-settings-resource-list role="group" aria-label={props.label}>{props.children}</SettingsList>;
}

export function SettingsResourceRow(props: { label: string; onClick: () => void; children: JSX.Element; disabled?: boolean }) {
  // IMPORTANT: Resource identities come from their owning inventory. This
  // adapter only composes published controls; it never selects a fallback ID.
  return <Button variant="ghost" class="settings-resource-row" aria-label={props.label} disabled={props.disabled} onClick={props.onClick}>
    <span class="settings-resource-identity">{props.children}</span><ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  </Button>;
}
