/**
 * 浏览器启动 —— 使用系统 Chrome，支持 CDP 连接和 channel 模式
 */
const { chromium } = require('playwright');
const config = require('../config');
const logger = require('../helpers/logger');

/**
 * 启动/连接浏览器
 * 策略 A: 尝试连接已运行的 CDP Chrome
 * 策略 B: 使用 channel: 'chrome' 启动系统 Chrome
 *
 * @returns {Promise<{ browser, context, page }>}
 */
async function launchBrowser() {
  let browser;
  let context;
  let page;

  // ---- 策略 A: CDP 连接 ----
  const cdpUrl = `http://localhost:${config.chrome.cdpPort}`;
  try {
    logger.step(`Trying CDP attach: ${cdpUrl}`);
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 5000 });
    logger.info('CDP attached successfully');

    // CDP 连接复用已有 context
    const contexts = browser.contexts();
    context = contexts[0];
    const pages = context.pages();
    page = pages[0] || await context.newPage();

    return { browser, context, page, mode: 'cdp' };
  } catch (cdpErr) {
    logger.info(`CDP attach failed (${cdpErr.message}), trying channel mode...`);
  }

  // ---- 策略 B: channel 模式启动系统 Chrome ----
  logger.step('Launching system Chrome via channel mode');
  try {
    browser = await chromium.launch({
      channel: 'chrome',               // 使用系统已安装的 Chrome
      headless: false,                  // 必须可见，方便人工扫码登录
      args: [
        '--disable-blink-features=AutomationControlled',
        `--user-data-dir=${config.chrome.userDataDir}`,
        '--start-maximized',
      ],
    });
  } catch (channelErr) {
    // channel 模式失败，尝试 exePath
    logger.warn(`Channel mode failed (${channelErr.message}), trying exePath...`);
    browser = await chromium.launch({
      executablePath: config.chrome.exePath,
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        `--user-data-dir=${config.chrome.userDataDir}`,
        '--start-maximized',
      ],
    });
  }

  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });
  page = await context.newPage();

  logger.info('Browser launched successfully');
  return { browser, context, page, mode: 'channel' };
}

module.exports = { launchBrowser };
