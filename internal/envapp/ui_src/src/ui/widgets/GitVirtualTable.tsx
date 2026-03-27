import { For, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface GitVirtualTableProps<T> {
  items: T[];
  header: JSX.Element;
  renderRow: (item: T, index: number) => JSX.Element;
  tableClass: string;
  viewportClass?: string;
}

export function GitVirtualTable<T>(props: GitVirtualTableProps<T>) {
  return (
    <div class={cn('min-h-0 flex-1 overflow-auto', props.viewportClass)}>
      <table class={props.tableClass}>
        <thead>{props.header}</thead>
        <tbody>
          <For each={props.items}>
            {(item, index) => props.renderRow(item, index())}
          </For>
        </tbody>
      </table>
    </div>
  );
}
