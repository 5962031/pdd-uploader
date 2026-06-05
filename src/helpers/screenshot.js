/**
 * 带时间戳的截图工具
 */
const path = require('path');
const config = require('../config');
const logger = require('./logger');

/**
 * 截图并保存到 screenshots 目录
 * @param {import('playwright').Page} page
 * @param {string} stepName - 步骤名称，如 '01_login_qr'
 * @returns {Promise<string>} 截图文件路径
 */
async function takeScreenshot(page, stepName) {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-');
  const filename = `${ts}_${stepName}.png`;
  const filepath = path.join(config.paths.screenshots, filename);

  try {
    await page.screenshot({ path: filepath, fullPage: true });
    logger.info(`[SCREENSHOT] ${filepath}`);
  } catch (err) {
    // fullPage 失败时回退到视口截图
    logger.warn(`fullPage screenshot failed, falling back to viewport: ${err.message}`);
    await page.screenshot({ path: filepath });
  }

  return filepath;
}

module.exports = { takeScreenshot };
