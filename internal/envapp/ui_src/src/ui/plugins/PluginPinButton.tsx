import { createSignal, type JSX } from 'solid-js';
import { cn, useNotification } from '@floegence/floe-webapp-core';
import { Button } from '@floegence/floe-webapp-core/ui';
import { Pin } from '@floegence/floe-webapp-core/icons';
import { useI18n } from '../i18n';
import type { PluginPinPlacement } from './pluginDockPins';

/** Placement is a Shell preference; this control never opens or authorizes a surface. */
export function PluginPinButton(props: {
  pluginName: string;
  placement?: PluginPinPlacement;
  pinned: boolean;
  disabled?: boolean;
  class?: string;
  onSetPinned: (pinned: boolean) => void | Promise<void>;
}): JSX.Element {
  const i18n = useI18n();
  const notify = useNotification();
  const [pending, setPending] = createSignal(false);
  const label = () => props.placement === 'workbench'
    ? i18n.t(props.pinned ? 'uiCopy.plugin.unpinFromWorkbenchDock' : 'uiCopy.plugin.pinToWorkbenchDock')
    : i18n.t(props.pinned ? 'uiCopy.plugin.unpinFromActivityBar' : 'uiCopy.plugin.pinToActivityBar');
  const toggle = async () => {
    if (pending() || props.disabled) return;
    setPending(true);
    try {
      await props.onSetPinned(!props.pinned);
    } catch (error) {
      notify.error(label(), error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };
  return <Button
    variant="ghost"
    size="icon"
    type="button"
    data-plugin-quick-pin
    aria-label={props.pluginName + ': ' + label()}
    aria-pressed={props.pinned}
    aria-busy={pending()}
    title={label()}
    disabled={pending() || props.disabled}
    class={cn(
      'h-11 w-11 shrink-0 sm:h-8 sm:w-8',
      props.pinned && 'bg-[var(--floe-state-selected)] text-primary',
      props.class,
    )}
    on:pointerdown={(event) => event.stopPropagation()}
    on:click={(event) => { event.stopPropagation(); void toggle(); }}
  >
    <Pin class={cn('h-3.5 w-3.5', props.pinned && 'fill-current')} />
  </Button>;
}
