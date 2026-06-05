/**
 * 快速检查脚本 —— 连接浏览器并截图当前页面，方便调试
 * 用法: node src/inspect.js
 */
const { launchBrowser } = require('./browser/launcher');
const { takeScreenshot } = require('./helpers/screenshot');
const logger = require('./helpers/logger');

async function inspect() {
  logger.info('Connecting to browser...');
  const { page } = await launchBrowser();

  logger.info(`Current URL: ${page.url()}`);
  logger.info(`Page title: ${await page.title()}`);

  await takeScreenshot(page, 'inspect');

  logger.info('Inspect complete. Check logs/screenshots/');
}

inspect().catch(err => {
  logger.error(err.message);
  process.exit(1);
});
