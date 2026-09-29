import { Show, createSignal, createUniqueId, type JSX } from 'solid-js';
import { Button, Dropdown, FeedbackIndicator, type DropdownItem, type FeedbackIndicatorEntry } from '@floegence/floe-webapp-core/ui';
import { ChevronRight, MoreHorizontal, Refresh } from '@floegence/floe-webapp-core/icons';
import { useFlowerExtensions } from './context';

export function FieldLabel(props: { children: JSX.Element; hint?: string }) {
  return <div class="flower-extension-label">{props.children}<Show when={props.hint}><span>{props.hint}</span></Show></div>;
}
export function SettingsSection(props: { title: string; badge?: string; error?: string | null; feedback?: readonly FeedbackIndicatorEntry[]; actions?: JSX.Element; children: JSX.Element }) {
  const { i18n } = useFlowerExtensions();
  let section: HTMLElement | undefined;
  return <section ref={section} class="flower-extension-section" tabIndex={-1}>
    <header class="flower-extension-section-header"><div class="flower-extension-heading"><h2>{props.title}</h2><Show when={props.badge}><span class="flower-extension-count">{props.badge}</span></Show></div><div class="flower-extension-actions">{props.actions}<FeedbackIndicator label={props.title} closeLabel={i18n.t('common.actions.close')} entries={props.feedback ?? []} restoreFocus={() => section} /></div></header>
    <Show when={props.error}><p role="alert" class="flower-extension-error">{props.error}</p></Show>
    {props.children}
  </section>;
}
export function SettingsPill(props: { tone?: string; children: string }) {
  return <span class="flower-extension-status" data-tone={props.tone} title={props.children}><span>{props.children}</span></span>;
}
export function SettingsList(props: { children: JSX.Element }) { return <div class="flower-extension-list">{props.children}</div>; }
export function SettingRow(props: { title: string; description: string; metadata: JSX.Element; control: JSX.Element; children: JSX.Element }) {
  const { i18n } = useFlowerExtensions();
  const [expanded, setExpanded] = createSignal(false);
  const id = createUniqueId();
  return <article class="flower-extension-row" data-expanded={expanded()}>
    <div class="flower-extension-row-main">
      <Button class="flower-extension-disclosure" size="icon" variant="ghost" icon={ChevronRight}
        aria-label={i18n.t('details', { name: props.title })} title={i18n.t('details', { name: props.title })}
        aria-expanded={expanded()} aria-controls={id} onClick={() => setExpanded(value => !value)} />
      <div class="flower-extension-identity"><h3 title={props.title}>{props.title}</h3><p title={props.description}>{props.description}</p></div>
      <div class="flower-extension-meta">{props.metadata}</div>
      <div class="flower-extension-row-control">{props.control}</div>
    </div>
    <div id={id} class="flower-extension-row-detail" hidden={!expanded()}>
      <Show when={expanded()}><h4>{props.title}</h4><p class="flower-extension-full-description">{props.description}</p>{props.children}</Show>
    </div>
  </article>;
}
export function RowMenu(props: { name: string; busy?: boolean; items: DropdownItem[]; onSelect: (id: string) => void }) {
  const { i18n } = useFlowerExtensions();
  return <span class="flower-extension-menu-slot" aria-busy={props.busy || undefined}><Show when={props.items.length}>
    <Dropdown align="end" triggerAriaLabel={i18n.t('actions', { name: props.name })}
      triggerClass="flower-extension-menu-button" trigger={<Show when={props.busy} fallback={<MoreHorizontal class="h-4 w-4" />}><Refresh class="h-4 w-4 animate-spin" /></Show>}
      items={props.items} disabled={props.busy} onSelect={props.onSelect} />
  </Show></span>;
}
