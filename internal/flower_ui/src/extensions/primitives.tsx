import { Show, type Component, type JSX } from 'solid-js';
import { FeedbackIndicator, type FeedbackIndicatorEntry } from '@floegence/floe-webapp-core/ui';
import { useFlowerExtensions } from './context';

export function FieldLabel(props: { children: JSX.Element; hint?: string }) {
  return <div class="flower-extension-label">{props.children}<Show when={props.hint}><span>{props.hint}</span></Show></div>;
}
export function SettingsSection(props: { variant?: string; icon?: Component<{ class?: string }>; title: string; description?: string; badge?: string; error?: string | null; feedback?: readonly FeedbackIndicatorEntry[]; actions?: JSX.Element; children: JSX.Element }) {
  const { i18n } = useFlowerExtensions();
  let section: HTMLElement | undefined;
  return <section ref={section} class="flower-extension-section" tabIndex={-1}>
    <header class="flower-extension-section-header"><div><div class="flower-extension-heading"><h2>{props.title}</h2><Show when={props.badge}><span class="flower-extension-count">{props.badge}</span></Show></div><p>{props.description}</p></div><div class="flower-extension-actions">{props.actions}<FeedbackIndicator label={props.title} closeLabel={i18n.t('common.actions.close')} entries={props.feedback ?? []} restoreFocus={() => section} /></div></header>
    <Show when={props.error}><p role="alert" class="flower-extension-error">{props.error}</p></Show>
    {props.children}
  </section>;
}
export function SettingsPill(props: { tone?: string; children: JSX.Element }) {
  return <span class="flower-extension-status" data-tone={props.tone}>{props.children}</span>;
}
export function SettingsList(props: { children: JSX.Element }) { return <div class="flower-extension-list">{props.children}</div>; }
export function SettingRow(props: { icon?: Component<{ class?: string }>; title: string; description: string; control: JSX.Element; children: JSX.Element }) {
  return <article class="flower-extension-row"><div class="flower-extension-row-main"><div class="flower-extension-icon"><Show when={props.icon}>{Icon => { const Glyph = Icon(); return <Glyph class="h-4 w-4" />; }}</Show></div><div class="flower-extension-identity"><h3>{props.title}</h3><p>{props.description}</p></div><div class="flower-extension-row-control">{props.control}</div></div><div class="flower-extension-row-body">{props.children}</div></article>;
}
