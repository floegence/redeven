import { onCleanup, onMount, type Accessor } from 'solid-js';
import { useFileBrowser } from '@floegence/floe-webapp-core/file-browser';

export interface UseFileBrowserTypeToFilterOptions {
  rootRef: Accessor<HTMLElement | null | undefined>;
  filterInputRef: Accessor<HTMLInputElement | null | undefined>;
  enabled?: Accessor<boolean>;
  captureWhenBodyFocused?: Accessor<boolean>;
}

const INTERACTIVE_SELECTOR = 'button, input, select, textarea, a, [role="button"], [role="textbox"], [contenteditable="true"]';

function isTypingElement(target: EventTarget | null): target is HTMLElement {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;

  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return target.getAttribute('role') === 'textbox';
}

function isInteractiveElement(target: EventTarget | null): target is HTMLElement {
  return typeof HTMLElement !== 'undefined'
    && target instanceof HTMLElement
    && Boolean(target.closest(INTERACTIVE_SELECTOR));
}

function isPrintableKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.isComposing || event.key === 'Dead' || event.key === 'Process') return false;
  return event.key.length === 1;
}

function focusFilterInput(input: HTMLInputElement | null | undefined) {
  if (!input) return;

  requestAnimationFrame(() => {
    input.focus();
    const cursor = input.value.length;
    input.setSelectionRange(cursor, cursor);
  });
}

export function useFileBrowserTypeToFilter(options: UseFileBrowserTypeToFilterOptions): void {
  const browser = useFileBrowser();
  const enabled = options.enabled ?? (() => true);
  const captureWhenBodyFocused = options.captureWhenBodyFocused ?? (() => false);

  const shouldCaptureEvent = (event: KeyboardEvent, root: HTMLElement) => {
    if (!enabled()) return false;
    if (event.defaultPrevented) return false;

    const target = event.target;
    if (isTypingElement(target)) return false;

    const activeElement = typeof document !== 'undefined' ? document.activeElement : null;
    if (isTypingElement(activeElement)) return false;

    if (target instanceof Node && root.contains(target)) return true;
    if (activeElement instanceof Node && root.contains(activeElement)) return true;

    return captureWhenBodyFocused()
      && (activeElement === document.body || activeElement === document.documentElement || activeElement == null);
  };

  const handleWindowKeyDown = (event: KeyboardEvent) => {
    const root = options.rootRef();
    const filterInput = options.filterInputRef();
    if (!root || !filterInput) return;
    if (!shouldCaptureEvent(event, root)) return;

    if (isPrintableKey(event)) {
      event.preventDefault();
      browser.setFilterActive(true);
      browser.setFilterQuery(`${browser.filterQuery()}${event.key}`);
      focusFilterInput(filterInput);
      return;
    }

    if (event.key === 'Backspace' && (browser.filterQuery().length > 0 || browser.isFilterActive())) {
      event.preventDefault();
      browser.setFilterActive(true);
      browser.setFilterQuery(browser.filterQuery().slice(0, -1));
      focusFilterInput(filterInput);
    }
  };

  const handleRootPointerDown = (event: PointerEvent) => {
    const root = options.rootRef();
    if (!root || !enabled()) return;
    if (isInteractiveElement(event.target)) return;

    root.focus();
  };

  onMount(() => {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', handleWindowKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleWindowKeyDown));
  });

  onMount(() => {
    const root = options.rootRef();
    if (!root) return;

    root.addEventListener('pointerdown', handleRootPointerDown);
    onCleanup(() => root.removeEventListener('pointerdown', handleRootPointerDown));
  });
}
