/// <reference lib="dom" />

import { bootstrapDesktopAskFlowerHandoffBridge } from './askFlowerHandoff';
import { bootstrapDesktopStateStorageBridge } from './desktopStateStorage';
import { bootstrapDesktopWindowThemeReporter } from './windowTheme';

bootstrapDesktopAskFlowerHandoffBridge();
bootstrapDesktopStateStorageBridge();
bootstrapDesktopWindowThemeReporter();
