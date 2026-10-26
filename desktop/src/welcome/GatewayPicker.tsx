import { ChevronDown } from '@floegence/floe-webapp-core/icons';
import { Dropdown } from '@floegence/floe-webapp-core/ui';

/** Shared Dropdown owns the menu, keyboard navigation and field focus. */
export function GatewayPicker(props: Readonly<{
  label: string; placeholder: string; value: string; disabled: boolean;
  options: { value: string; label: string }[]; onChange: (value: string) => void;
}>) {
  const selected = () => props.options.find(option => option.value === props.value);
  return <div class="redeven-gateway-join-field">
    <span>{props.label}</span>
    <Dropdown class="redeven-gateway-saved-picker" triggerClass="redeven-gateway-picker-trigger"
      triggerInputSurface triggerAriaLabel={props.label} disabled={props.disabled}
      value={props.value} items={() => props.options.map(option => ({ id: option.value, label: option.label }))}
      onSelect={props.onChange} trigger={<>
        <span class="min-w-0 truncate" classList={{ 'text-muted-foreground': !selected() }} title={selected()?.label}>{selected()?.label ?? props.placeholder}</span>
        <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </>} />
  </div>;
}
