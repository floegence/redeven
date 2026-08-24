import { describe, expect, it } from 'vitest';

import { createDesktopI18n } from '../shared/i18n/desktopI18n';
import { buildDesktopUpdateHandoffMessageBoxOptions } from './desktopUpdateHandoff';

describe('desktopUpdateHandoff', () => {
  it('warns that installing the Desktop update restarts Desktop and the Local Runtime', () => {
    expect(buildDesktopUpdateHandoffMessageBoxOptions(createDesktopI18n('en-US'))).toEqual({
      type: 'info',
      buttons: ['Open release page', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Redeven Desktop?',
      message: 'Installing the new version will restart Redeven Desktop and the Local Runtime.',
      detail: 'Active Local Environment sessions will be interrupted.',
    });
  });

  it('uses the current Desktop language for the native dialog', () => {
    expect(buildDesktopUpdateHandoffMessageBoxOptions(createDesktopI18n('zh-CN'))).toMatchObject({
      buttons: ['打开发布页面', '稍后'],
      title: '更新 Redeven Desktop？',
      message: '安装新版本将重启 Redeven Desktop 和本机运行时。',
      detail: '正在使用的本机环境会话将会中断。',
    });
  });
});
