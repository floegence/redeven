/// <reference lib="dom" />

import { bootstrapDesktopEmbeddedDragHostBridge } from './desktopEmbeddedDragHost';
import { bootstrapDesktopCodeWorkspaceBridge } from './desktopCodeWorkspace';
import { bootstrapDesktopDownloadsBridge } from './desktopDownloads';
import { bootstrapDesktopSessionContextBridge } from './desktopSessionContext';
import { bootstrapDesktopShellBridge } from './desktopShell';
import { bootstrapDesktopStateStorageBridge } from './desktopStateStorage';
import { bootstrapDesktopLanguageBridge } from './desktopLanguage';
import { bootstrapDesktopThemeBridge } from './windowTheme';
import { bootstrapDesktopUpdateBridge } from './desktopUpdate';

bootstrapDesktopDownloadsBridge();
bootstrapDesktopCodeWorkspaceBridge();
bootstrapDesktopEmbeddedDragHostBridge();
bootstrapDesktopLanguageBridge();
bootstrapDesktopSessionContextBridge();
bootstrapDesktopShellBridge();
bootstrapDesktopStateStorageBridge();
bootstrapDesktopThemeBridge();
bootstrapDesktopUpdateBridge();
