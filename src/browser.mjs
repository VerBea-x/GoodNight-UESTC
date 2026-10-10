import { chromium } from 'playwright';
import path from 'node:path';
export function launchBrowser(config, dataDir, { visible = false } = {}) {
  return chromium.launchPersistentContext(path.join(dataDir, 'profile'), {
    channel: config.browserChannel, headless: visible ? false : config.headless,
    ignoreDefaultArgs: ['--use-mock-keychain'],
    args: ['--restore-last-session', '--no-first-run', '--no-default-browser-check'],
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 1200, height: 850 },
    timeout: 30000,
  });
}
