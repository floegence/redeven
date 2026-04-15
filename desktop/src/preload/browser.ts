/// <reference lib="dom" />

import { bootstrapDesktopAskFlowerHandoffBridge } from './askFlowerHandoff';
import { bootstrapDesktopLauncherBridge } from './desktopLauncher';
import { bootstrapDesktopSessionContextBridge } from './desktopSessionContext';
import { bootstrapDesktopSettingsBridge } from './desktopSettingsBridge';
import { bootstrapDesktopShellBridge } from './desktopShell';
import { bootstrapDesktopStateStorageBridge } from './desktopStateStorage';
import { bootstrapDesktopThemeBridge } from './windowTheme';

bootstrapDesktopAskFlowerHandoffBridge();
bootstrapDesktopLauncherBridge();
bootstrapDesktopSessionContextBridge();
bootstrapDesktopSettingsBridge();
bootstrapDesktopShellBridge();
bootstrapDesktopStateStorageBridge();
bootstrapDesktopThemeBridge();
