/// <reference lib="dom" />

import { bootstrapDesktopEmbeddedDragHostBridge } from './desktopEmbeddedDragHost';
import { bootstrapDesktopSessionContextBridge } from './desktopSessionContext';
import { bootstrapDesktopShellBridge } from './desktopShell';
import { bootstrapDesktopStateStorageBridge } from './desktopStateStorage';
import { bootstrapDesktopThemeBridge } from './windowTheme';

bootstrapDesktopEmbeddedDragHostBridge();
bootstrapDesktopSessionContextBridge();
bootstrapDesktopShellBridge();
bootstrapDesktopStateStorageBridge();
bootstrapDesktopThemeBridge();
