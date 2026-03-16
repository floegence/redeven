export interface FileBrowserPathSegment {
  name: string;
  path: string;
}

export interface FileBrowserPathLayoutOptions {
  containerWidth: number;
  segments: FileBrowserPathSegment[];
  segmentWidths: number[];
  separatorWidth: number;
  ellipsisWidth: number;
  currentSegmentMinWidth?: number;
}

export interface FileBrowserPathLayoutResult {
  visible: FileBrowserPathSegment[];
  collapsed: FileBrowserPathSegment[];
  shouldCollapse: boolean;
}

export const FILE_BROWSER_PATH_CURRENT_MIN_WIDTH = 96;
export const FILE_BROWSER_WORKSPACE_INLINE_MIN_WIDTH = 640;

export function buildFileBrowserPathSegments(path: string, homeLabel: string): FileBrowserPathSegment[] {
  if (path === '/' || path === '') {
    return [{ name: homeLabel, path: '/' }];
  }

  const parts = path.split('/').filter(Boolean);
  const result: FileBrowserPathSegment[] = [{ name: homeLabel, path: '/' }];

  let currentPath = '';
  for (const part of parts) {
    currentPath += `/${part}`;
    result.push({ name: part, path: currentPath });
  }

  return result;
}

export function resolveFileBrowserPathLayout(options: FileBrowserPathLayoutOptions): FileBrowserPathLayoutResult {
  const { containerWidth, segments, segmentWidths, separatorWidth, ellipsisWidth } = options;
  const currentSegmentMinWidth = Math.max(0, options.currentSegmentMinWidth ?? FILE_BROWSER_PATH_CURRENT_MIN_WIDTH);

  if (segments.length <= 2 || containerWidth <= 0 || segmentWidths.length !== segments.length || segmentWidths.some((width) => width <= 0)) {
    return {
      visible: segments,
      collapsed: [],
      shouldCollapse: false,
    };
  }

  const firstSegment = segments[0];
  const lastSegment = segments[segments.length - 1];
  const middleSegments = segments.slice(1, -1);
  const firstWidth = segmentWidths[0] ?? 0;
  const middleWidths = segmentWidths.slice(1, -1);

  for (let visibleMiddleCount = middleSegments.length; visibleMiddleCount >= 0; visibleMiddleCount -= 1) {
    const collapsedCount = middleSegments.length - visibleMiddleCount;
    let requiredWidth = firstWidth + separatorWidth + currentSegmentMinWidth;

    if (collapsedCount > 0) {
      requiredWidth += separatorWidth + ellipsisWidth;
    }

    const visibleMiddleWidths = middleWidths.slice(middleWidths.length - visibleMiddleCount);
    for (const width of visibleMiddleWidths) {
      requiredWidth += separatorWidth + width;
    }

    if (requiredWidth <= containerWidth || visibleMiddleCount === 0) {
      const visibleMiddle = middleSegments.slice(middleSegments.length - visibleMiddleCount);
      const collapsed = middleSegments.slice(0, middleSegments.length - visibleMiddle.length);

      return {
        visible: [firstSegment, ...visibleMiddle, lastSegment],
        collapsed,
        shouldCollapse: collapsed.length > 0,
      };
    }
  }

  return {
    visible: [firstSegment, lastSegment],
    collapsed: middleSegments,
    shouldCollapse: true,
  };
}

export function resolveFileBrowserToolbarLayout(width: number): 'inline' | 'stacked' {
  return width > 0 && width < FILE_BROWSER_WORKSPACE_INLINE_MIN_WIDTH ? 'stacked' : 'inline';
}
