// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FloatingContextMenu, type FloatingContextMenuItem } from './FloatingContextMenu';
import {
  GitEntityContextMenu,
  composeGitContextMenuItems,
  createGitEntityContextMenuController,
  type GitContextMenuActionItem,
  type GitEntityContextMenuController,
} from './GitEntityContextMenu';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@floegence/floe-webapp-core/ui')>(),
  SurfaceFloatingLayer: (props: any) => {
    const { children, layerRef, position, class: className, ...rest } = props;
    return (
      <div
        ref={(element) => layerRef?.(element)}
        class={className}
        style={{ left: `${position.x}px`, top: `${position.y}px` }}
        {...rest}
      >
        {children}
      </div>
    );
  },
}));

const TestIcon = (props: { class?: string }) => <span class={props.class} aria-hidden="true" />;

function action(
  id: string,
  group: GitContextMenuActionItem['group'],
  onSelect: () => void = () => undefined,
  rank = 100,
): GitContextMenuActionItem {
  return { id, group, rank, kind: 'action', label: id, icon: TestIcon, onSelect };
}

function dispatchKey(target: Element, key: string, options: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Git context action grouping', () => {
  it('uses the six explicit groups and inserts separators only between non-empty groups', () => {
    const items = composeGitContextMenuItems([
      action('copy-sha', 'clipboard'),
      action('checkout', 'modify'),
      action('ask-flower', 'assistant'),
      action('open-files', 'navigate', undefined, 20),
      action('delete-branch', 'destructive'),
      action('preview', 'inspect'),
      action('open-terminal', 'navigate', undefined, 10),
    ]);

    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'action:ask-flower',
      'separator:separator-inspect',
      'action:preview',
      'separator:separator-navigate',
      'action:open-terminal',
      'action:open-files',
      'separator:separator-modify',
      'action:checkout',
      'separator:separator-clipboard',
      'action:copy-sha',
      'separator:separator-destructive',
      'action:delete-branch',
    ]);
    expect(items[0]?.kind).not.toBe('separator');
    expect(items.at(-1)?.kind).not.toBe('separator');
    expect(items.some((item, index) => item.kind === 'separator' && items[index + 1]?.kind === 'separator')).toBe(false);
  });
});

describe('FloatingContextMenu keyboard contract', () => {
  it('keeps unavailable actions focusable and supports complete menu navigation and activation', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const firstSelect = vi.fn();
    const secondSelect = vi.fn();
    const items: FloatingContextMenuItem[] = [
      {
        id: 'unavailable',
        kind: 'action',
        label: 'Unavailable preview',
        icon: TestIcon,
        onSelect: firstSelect,
        disabledReason: 'This commit does not contain the file.',
      },
      { id: 'open', kind: 'action', label: 'Open', icon: TestIcon, onSelect: secondSelect },
      { id: 'separator', kind: 'separator' },
      { id: 'copy', kind: 'action', label: 'Copy', icon: TestIcon, onSelect: vi.fn() },
    ];

    const dispose = render(() => (
      <FloatingContextMenu
        x={12}
        y={24}
        ariaLabel="Git actions"
        focusDisabledItems
        items={items}
        onDismiss={() => undefined}
      />
    ), host);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    try {
      const menuItems = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      expect(document.activeElement).toBe(menuItems[0]);
      expect(menuItems[0]?.getAttribute('aria-disabled')).toBe('true');
      expect(menuItems[0]?.disabled).toBe(false);
      expect(menuItems[0]?.title).toBe('This commit does not contain the file.');
      const disabledDescriptionID = menuItems[0]?.getAttribute('aria-describedby');
      expect(disabledDescriptionID).toBeTruthy();
      expect(document.getElementById(disabledDescriptionID!)?.textContent).toBe('This commit does not contain the file.');

      dispatchKey(menuItems[0]!, 'Enter');
      expect(firstSelect).not.toHaveBeenCalled();
      dispatchKey(menuItems[0]!, 'ArrowDown');
      expect(document.activeElement).toBe(menuItems[1]);
      dispatchKey(menuItems[1]!, ' ');
      expect(secondSelect).toHaveBeenCalledTimes(1);
      dispatchKey(menuItems[1]!, 'End');
      expect(document.activeElement).toBe(menuItems[2]);
      dispatchKey(menuItems[2]!, 'ArrowDown');
      expect(document.activeElement).toBe(menuItems[0]);
      dispatchKey(menuItems[0]!, 'ArrowUp');
      expect(document.activeElement).toBe(menuItems[2]);
      dispatchKey(menuItems[2]!, 'Home');
      expect(document.activeElement).toBe(menuItems[0]);
    } finally {
      dispose();
    }
  });

  it.each(['Escape', 'Tab'])('requests close on %s without overriding generic focus semantics', async (key) => {
    const trigger = document.createElement('button');
    const host = document.createElement('div');
    document.body.append(trigger, host);
    const onRequestClose = vi.fn();

    const dispose = render(() => (
      <FloatingContextMenu
        x={0}
        y={0}
        ariaLabel="Git actions"
        focusAnchor={trigger}
        items={[action('ask', 'assistant')]}
        onDismiss={onRequestClose}
      />
    ), host);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    try {
      dispatchKey(host.querySelector('[role="menuitem"]')!, key);
      await Promise.resolve();
      expect(onRequestClose).toHaveBeenCalledWith(key === 'Escape' ? 'escape' : 'tab');
      if (key === 'Tab') {
        expect(document.activeElement).toBe(trigger);
      } else {
        expect(document.activeElement).not.toBe(trigger);
      }
    } finally {
      dispose();
    }
  });

  it.each([
    { key: 'Escape', reason: 'escape', options: {} },
    { key: 'Tab', reason: 'tab', options: {} },
    { key: 'Tab', reason: 'shift-tab', options: { shiftKey: true } },
  ] as const)('dismisses an all-disabled menu on $reason', async ({ key, reason, options }) => {
    const trigger = document.createElement('button');
    const host = document.createElement('div');
    document.body.append(trigger, host);
    const onDismiss = vi.fn();
    const parentKeyDown = vi.fn();
    const dispose = render(() => (
      <div onKeyDown={parentKeyDown}>
        <FloatingContextMenu
          x={0}
          y={0}
          ariaLabel="Disabled actions"
          focusAnchor={trigger}
          items={[{ ...action('disabled', 'inspect'), disabled: true }]}
          onDismiss={onDismiss}
        />
      </div>
    ), host);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    try {
      const menu = host.querySelector('[role="menu"]')!;
      dispatchKey(menu, key, options as KeyboardEventInit);
      expect(onDismiss).toHaveBeenCalledWith(reason);
      if (key === 'Escape') {
        expect(parentKeyDown).not.toHaveBeenCalled();
        expect(document.activeElement).not.toBe(trigger);
      } else {
        expect(document.activeElement).toBe(trigger);
      }
    } finally {
      dispose();
    }
  });
});

describe('GitEntityContextMenu controller', () => {
  it('opens from pointer and keyboard with a stable target snapshot', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let controller!: GitEntityContextMenuController<{ path: string }>;
    const target = { path: 'src/old.ts' };

    const dispose = render(() => {
      controller = createGitEntityContextMenuController<{ path: string }>();
      return (
        <button
          type="button"
          onContextMenu={(event) => controller.openFromContextMenu(event, target)}
          onKeyDown={(event) => controller.openFromKeyboard(event, target)}
        >
          File
        </button>
      );
    }, host);
    const trigger = host.querySelector('button')!;
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 30,
      y: 40,
      left: 30,
      top: 40,
      right: 130,
      bottom: 64,
      width: 100,
      height: 24,
      toJSON: () => ({}),
    });

    try {
      trigger.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 71,
        clientY: 93,
      }));
      target.path = 'src/new.ts';
      expect(controller.state()).toMatchObject({ x: 71, y: 93, target: { path: 'src/old.ts' } });

      controller.close();
      dispatchKey(trigger, 'ContextMenu');
      expect(controller.state()).toMatchObject({ x: 30, y: 64, target: { path: 'src/new.ts' } });

      controller.close();
      dispatchKey(trigger, 'F10', { shiftKey: true });
      expect(controller.state()).toMatchObject({ x: 30, y: 64 });
      await Promise.resolve();
    } finally {
      dispose();
    }
  });

  it('closes for outside pointer, scroll, window blur, Escape, Tab, selection, and unmount', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let controller!: GitEntityContextMenuController<{ id: string }>;
    const onSelect = vi.fn();

    const dispose = render(() => {
      controller = createGitEntityContextMenuController<{ id: string }>();
      return (
        <>
          <button
            type="button"
            data-testid="trigger"
            onContextMenu={(event) => controller.openFromContextMenu(event, { id: 'commit-a' })}
          >
            Commit
          </button>
          <GitEntityContextMenu
            controller={controller}
            items={() => [action('ask-flower', 'assistant', onSelect)]}
          />
        </>
      );
    }, host);
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="trigger"]')!;
    const open = async () => {
      trigger.focus();
      trigger.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      expect(controller.state()).not.toBeNull();
    };

    await open();
    const nextTarget = document.createElement('button');
    document.body.appendChild(nextTarget);
    nextTarget.focus();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await Promise.resolve();
    expect(controller.state()).toBeNull();
    expect(document.activeElement).toBe(nextTarget);

    await open();
    document.dispatchEvent(new Event('scroll'));
    expect(controller.state()).toBeNull();

    await open();
    window.dispatchEvent(new Event('blur'));
    expect(controller.state()).toBeNull();

    await open();
    dispatchKey(host.querySelector('[role="menuitem"]')!, 'Escape');
    expect(controller.state()).toBeNull();

    await open();
    dispatchKey(host.querySelector('[role="menuitem"]')!, 'Tab');
    expect(controller.state()).toBeNull();

    await open();
    host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(controller.state()).toBeNull();

    await open();
    dispose();
    await Promise.resolve();
    expect(controller.state()).toBeNull();
  });
});
