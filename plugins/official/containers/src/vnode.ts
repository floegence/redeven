import type {
  PluginUIElementVNode,
  PluginUIVNode,
} from '@floegence/redevplugin-ui/plugin';

export function element(
  key: string,
  tag: PluginUIElementVNode['tag'],
  attributes: Record<string, string | number | boolean> = {},
  children: PluginUIVNode[] = [],
): PluginUIVNode {
  return { type: 'element', key, tag, attributes, children };
}

export function text(key: string, value: string): PluginUIVNode {
  return { type: 'text', key, text: value };
}

export function empty(key: string): PluginUIVNode {
  return element(key, 'span', { hidden: true });
}

export function button(
  key: string,
  label: string,
  actionName: string,
  value = '',
  className = '',
  disabled = false,
  extra: Record<string, string | boolean> = {},
): PluginUIVNode {
  return element(key, 'button', {
    type: 'button',
    class: className,
    disabled,
    value,
    'data-redevplugin-action': actionName,
    ...extra,
  }, [text(`${key}-text`, label)]);
}
