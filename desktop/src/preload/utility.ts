/// <reference lib="dom" />

import { bootstrapDesktopLauncherBridge } from './desktopLauncher';
import { bootstrapDesktopDownloadsBridge } from './desktopDownloads';
import { bootstrapDesktopSettingsBridge } from './desktopSettingsBridge';
import { bootstrapDesktopShellBridge } from './desktopShell';
import { bootstrapDesktopStateStorageBridge } from './desktopStateStorage';
import { bootstrapDesktopLanguageBridge } from './desktopLanguage';
import { bootstrapDesktopThemeBridge } from './windowTheme';
import { bootstrapDesktopUpdateBridge } from './desktopUpdate';

bootstrapDesktopDownloadsBridge();
bootstrapDesktopLanguageBridge();
bootstrapDesktopLauncherBridge();
bootstrapDesktopSettingsBridge();
bootstrapDesktopShellBridge();
bootstrapDesktopStateStorageBridge();
bootstrapDesktopThemeBridge();
bootstrapDesktopUpdateBridge();
