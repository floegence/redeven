export interface DesktopWindowSpec {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  title?: string;
  attachToParent?: boolean;
}

const DEFAULT_WINDOW_SPEC: DesktopWindowSpec = {
  width: 1440,
  height: 960,
  minWidth: 1024,
  minHeight: 720,
};

const DETACHED_SURFACE_QUERY_KEY = 'redeven_detached_surface';

type DetachedSurfaceKind = 'file_preview' | 'file_browser';

function parseDetachedSurfaceKind(targetURL: string): DetachedSurfaceKind | '' {
  try {
    const url = new URL(targetURL);
    const value = String(url.searchParams.get(DETACHED_SURFACE_QUERY_KEY) ?? '').trim();
    if (value === 'file_preview' || value === 'file_browser') return value;
    return '';
  } catch {
    return '';
  }
}

export function resolveDesktopWindowSpec(targetURL: string, parented: boolean): DesktopWindowSpec {
  if (!parented) {
    return DEFAULT_WINDOW_SPEC;
  }

  const kind = parseDetachedSurfaceKind(targetURL);
  if (kind === 'file_preview') {
    return {
      width: 1180,
      height: 820,
      minWidth: 720,
      minHeight: 480,
      title: 'File Preview',
      attachToParent: false,
    };
  }
  if (kind === 'file_browser') {
    return {
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 640,
      title: 'File Browser',
      attachToParent: false,
    };
  }

  return DEFAULT_WINDOW_SPEC;
}
