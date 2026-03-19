/// <reference lib="dom" />

import { bootstrapDesktopStateStorageBridge } from './desktopStateStorage';
import { bootstrapDesktopWindowThemeReporter } from './windowTheme';

bootstrapDesktopStateStorageBridge();
bootstrapDesktopWindowThemeReporter();
