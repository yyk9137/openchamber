import type { RuntimeAPIs } from '@openchamber/ui/lib/api/types';
import {
  createRuntimeUrlResolver,
  setRuntimeUrlResolver,
  type RuntimeUrlResolver,
} from '@openchamber/ui/lib/runtime-url';
import { createWebTerminalAPI } from './terminal';
import { createWebGitAPI } from './git';
import { createWebFilesAPI } from './files';
import { createWebSettingsAPI } from './settings';
import { createWebPermissionsAPI } from './permissions';
import { createWebNotificationsAPI } from './notifications';
import { createWebToolsAPI } from './tools';
import { createWebPushAPI } from './push';
import { createWebGitHubAPI } from './github';

export interface WebAPIsOptions {
  urls?: RuntimeUrlResolver;
}

export const createWebAPIs = (options: WebAPIsOptions = {}): RuntimeAPIs => {
  const urls = options.urls ?? createRuntimeUrlResolver();
  setRuntimeUrlResolver(urls);

  return {
  runtime: { platform: 'web', isDesktop: false, isVSCode: false, label: 'web' },
  terminal: createWebTerminalAPI(),
  git: createWebGitAPI(),
  files: createWebFilesAPI({ urls }),
  settings: createWebSettingsAPI(),
  permissions: createWebPermissionsAPI(),
  notifications: createWebNotificationsAPI(),
  github: createWebGitHubAPI({ urls }),
  push: createWebPushAPI(),
  tools: createWebToolsAPI(),
  };
};
