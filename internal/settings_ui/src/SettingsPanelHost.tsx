import { createContext, useContext, createEffect, createSignal, on, untrack, onCleanup, type JSX } from 'solid-js';
import { createRetainedContent } from '@floegence/floe-webapp-core';
import type { SettingsSection, SettingsTarget } from './settingsSession';

export type SettingsPanelRegistration = Readonly<{ target: SettingsTarget; render: () => JSX.Element; onClose: () => void }>;
export type SettingsPanelHost = Readonly<{
  open: (target: SettingsTarget) => void;
  close: () => void;
  target: () => SettingsTarget | null;
  present: () => boolean;
  register: (entry: SettingsPanelRegistration) => () => void;
}>;
export const SettingsPanelContext = createContext<SettingsPanelHost>();
export const useSettingsPanelHost = () => useContext(SettingsPanelContext);

// IMPORTANT: Retained domain dialogs follow their host's exact presentation.
// Hiding a category never closes its draft or grants mutation authority.
export function useSettingsPresentation(section: SettingsSection) {
  const host = useSettingsPanelHost();
  return () => !host || host.present() && host.target()?.section === section && !host.target()?.resource;
}

/** Move the existing domain editor into its host, retaining its original owner. */
export function HostedSettingsPanel(props: {
  embedded?: boolean; target: SettingsTarget; open: boolean; onClose: () => void; children: JSX.Element;
  fallback: (body: JSX.Element) => JSX.Element;
}) {
  if (props.embedded) return props.children;
  const host = useSettingsPanelHost();
  if (!host) return props.fallback(props.children);
  const Content = createRetainedContent(() => props.children);
  const [captured, setCaptured] = createSignal<SettingsTarget | null>(null);
  createEffect(on(() => props.open ? JSON.stringify(props.target) : null, identity => {
    if (identity) {
      const target = { ...props.target };
      setCaptured(target);
      host.open(target);
    } else {
      const previous = captured();
      setCaptured(null);
      if (previous && host.target()?.section === previous.section && host.target()?.resource === previous.resource) host.close();
    }
  }));
  createEffect(() => {
    const target = captured();
    if (!target) return;
    const unregister = host.register({ target, render: () => <Content />, onClose: props.onClose });
    onCleanup(unregister);
  });
  // IMPORTANT: Opening the domain precedes registering its host target. Only a
  // real host close transition may close that domain; observing its new open
  // prop against the previous null target creates an effect-order race.
  createEffect(on(host.target, (next, previous) => {
    if (next === null && previous && props.open) untrack(props.onClose);
  }, { defer: true }));
  // IMPORTANT: Retain unsaved domain drafts during category changes. Never
  // instantiate the same editor twice or run a save from navigation itself.
  // The registered host is the only DOM placement. Floe retains the editor
  // between placements; a second parking mount races Solid's cleanup.
  return null;
}
