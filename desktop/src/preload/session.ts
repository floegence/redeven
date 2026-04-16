/// <reference lib="dom" />

import { bootstrapDesktopAskFlowerHandoffBridge } from './askFlowerHandoff';
import { bootstrapDesktopEmbeddedDragHostBridge } from './desktopEmbeddedDragHost';
import { bootstrapDesktopSessionContextBridge } from './desktopSessionContext';
import { bootstrapDesktopShellBridge } from './desktopShell';
import { bootstrapDesktopStateStorageBridge } from './desktopStateStorage';
import { bootstrapDesktopThemeBridge } from './windowTheme';

bootstrapDesktopAskFlowerHandoffBridge();
bootstrapDesktopEmbeddedDragHostBridge();
bootstrapDesktopSessionContextBridge();
bootstrapDesktopShellBridge();
bootstrapDesktopStateStorageBridge();
bootstrapDesktopThemeBridge();
