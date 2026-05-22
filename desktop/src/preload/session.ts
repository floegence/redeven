/// <reference lib="dom" />

import { bootstrapDesktopEmbeddedDragHostBridge } from './desktopEmbeddedDragHost';
import { bootstrapDesktopCodeWorkspaceBridge } from './desktopCodeWorkspace';
import { bootstrapDesktopDownloadsBridge } from './desktopDownloads';
import { bootstrapDesktopSessionContextBridge } from './desktopSessionContext';
import { bootstrapDesktopShellBridge } from './desktopShell';
import { bootstrapDesktopStateStorageBridge } from './desktopStateStorage';
import { bootstrapDesktopThemeBridge } from './windowTheme';

bootstrapDesktopDownloadsBridge();
bootstrapDesktopCodeWorkspaceBridge();
bootstrapDesktopEmbeddedDragHostBridge();
bootstrapDesktopSessionContextBridge();
bootstrapDesktopShellBridge();
bootstrapDesktopStateStorageBridge();
bootstrapDesktopThemeBridge();
