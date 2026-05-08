export interface TocItem {
  id: string;
  text: string;
  level: number;
  children: TocItem[];
}

export function buildToc(container: HTMLElement): TocItem[] {
  const headings = container.querySelectorAll<HTMLElement>('h1.fm-heading, h2.fm-heading, h3.fm-heading, h4.fm-heading');
  const items: TocItem[] = [];
  const stack: TocItem[] = [];

  for (const heading of headings) {
    const level = Number(heading.tagName[1]);
    const id = heading.id || '';
    const text = heading.textContent ?? '';

    const item: TocItem = { id, text, level, children: [] };

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    if (stack.length === 0) {
      items.push(item);
    } else {
      stack[stack.length - 1].children.push(item);
    }

    stack.push(item);
  }

  return items;
}
