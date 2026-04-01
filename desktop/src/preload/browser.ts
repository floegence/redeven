/// <reference lib="dom" />

import { bootstrapDesktopAskFlowerHandoffBridge } from './askFlowerHandoff';
import { bootstrapDesktopLauncherBridge } from './desktopLauncher';
import { bootstrapDesktopSettingsBridge } from './desktopSettingsBridge';
import { bootstrapDesktopShellBridge } from './desktopShell';
import { bootstrapDesktopStateStorageBridge } from './desktopStateStorage';
import { bootstrapDesktopWindowThemeReporter } from './windowTheme';

bootstrapDesktopAskFlowerHandoffBridge();
bootstrapDesktopLauncherBridge();
bootstrapDesktopSettingsBridge();
bootstrapDesktopShellBridge();
bootstrapDesktopStateStorageBridge();
bootstrapDesktopWindowThemeReporter();
