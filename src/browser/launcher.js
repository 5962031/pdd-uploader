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

  // ---- 策略 B: 自动启动系统 Chrome（persistent context） ----
  logger.step('Launching system Chrome with persistent context...');
  const userDataDir = config.chrome.userDataDir;
  const launchOpts = {
    headless: false,
    channel: 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
    ],
    viewport: null, // persistent context 用实际窗口大小
  };

  try {
    context = await chromium.launchPersistentContext(userDataDir, launchOpts);
  } catch (e1) {
    logger.warn(`Channel mode failed (${e1.message}), trying exePath...`);
    try {
      const opts2 = { ...launchOpts, executablePath: config.chrome.exePath, channel: undefined };
      context = await chromium.launchPersistentContext(userDataDir, opts2);
    } catch (e2) {
      logger.error(`exePath also failed (${e2.message})`);
      throw e2;
    }
  }

  browser = context.browser();
  const pages = context.pages();
  page = pages[0] || await context.newPage();

  logger.info('Browser launched successfully (persistent context)');
  return { browser, context, page, mode: 'channel' };
}

module.exports = { launchBrowser };
