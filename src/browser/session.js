/**
 * 登录态管理 —— 保存/恢复 storageState
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 尝试从 state 文件恢复登录态
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>} 是否恢复成功
 */
async function restoreSession(context, page) {
  const stateFile = config.paths.state;

  if (!fs.existsSync(stateFile)) {
    logger.info('No saved session found, need login');
    return false;
  }

  try {
    // Playwright 的 storageState 需要创建 context 时传入
    // 这里我们单独加载 cookies 和 localStorage
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));

    if (state.cookies && state.cookies.length > 0) {
      await context.addCookies(state.cookies);
      logger.info(`Restored ${state.cookies.length} cookies from session`);
    }

    // 验证登录态
    await page.goto(config.urls.mmsHome, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    const url = page.url();
    const isLoggedIn = !url.includes('/login');

    if (isLoggedIn) {
      logger.info('Session restored successfully, already logged in');
      await takeScreenshot(page, '02_login_session_restored');
      return true;
    }

    logger.warn('Session expired, need re-login');
    // 清理过期 state
    fs.unlinkSync(stateFile);
    return false;
  } catch (err) {
    logger.warn(`Session restore failed: ${err.message}`);
    return false;
  }
}

/**
 * 保存登录态
 * @param {import('playwright').BrowserContext} context
 */
async function saveSession(context) {
  const stateFile = config.paths.state;
  const dir = path.dirname(stateFile);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    const cookies = await context.cookies();
    const state = {
      cookies,
      _savedAt: new Date().toISOString(),
      _note: 'PDD merchant backend login state',
    };

    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    logger.info(`Session saved to ${stateFile} (${cookies.length} cookies)`);
  } catch (err) {
    logger.error(`Failed to save session: ${err.message}`);
  }
}

/**
 * 等待用户扫码/输入账号登录
 * @param {import('playwright').Page} page
 */
async function waitForLogin(page) {
  logger.step('Navigating to PDD MMS login page...');

  try {
    await page.goto(config.urls.mmsLogin, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (navErr) {
    logger.error(`Failed to navigate to login page: ${navErr.message}`);
    throw new Error(`Cannot reach MMS login page: ${navErr.message}`);
  }

  await page.waitForTimeout(2000);

  await takeScreenshot(page, '01_login_page');

  // 检测是否已经登录（已重定向到首页）
  const currentUrl = page.url();
  logger.info(`Current URL: ${currentUrl}`);
  if (!currentUrl.includes('/login')) {
    logger.info('Already logged in (redirected to home, no login needed)');
    await takeScreenshot(page, '02_already_logged_in');
    return;
  }

  // 检测 "账号登录" 标签
  const accountLoginTab = page.locator('text=账号登录');
  if (await accountLoginTab.count() > 0) {
    logger.info('Account login tab available — you can also use password login');
  }

  logger.info('========================================');
  logger.info('Please log in manually (scan QR or use account login)');
  logger.info(`Waiting up to ${config.timeouts.login / 1000}s for login...`);
  logger.info('========================================');

  // 使用 waitForFunction 判断 URL 变化（避免 waitForURL 的 URL 对象类型问题）
  const timeoutMs = config.timeouts.login;
  const startTime = Date.now();

  try {
    await page.waitForFunction(
      // 在浏览器上下文执行，直接读 location.href
      () => !window.location.href.includes('/login'),
      { timeout: timeoutMs, polling: 2000 }  // 每2秒检查一次
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    logger.info(`Login detected after ${elapsed}s!`);
    await page.waitForTimeout(1000);  // 等页面稳定
    await takeScreenshot(page, '02_login_success');
  } catch (waitErr) {
    // 打印真实错误
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    logger.error(`Login wait failed after ${elapsed}s`);
    logger.error(`  Error type: ${waitErr.constructor.name}`);
    logger.error(`  Error message: ${waitErr.message}`);

    // 再检查一次 —— 也许已经登录了但 URL 变了
    const finalUrl = page.url();
    logger.info(`  Final URL: ${finalUrl}`);
    if (!finalUrl.includes('/login')) {
      logger.info('Actually logged in! (race condition)');
      await takeScreenshot(page, '02_login_success');
      return;
    }

    throw new Error(
      `Login timeout after ${config.timeouts.login / 1000}s.\n` +
      `  Current URL: ${finalUrl}\n` +
      `  Error: ${waitErr.message}\n` +
      `  Make sure you completed the login (scan QR or enter credentials) in the Chrome window.`
    );
  }
}

module.exports = { restoreSession, saveSession, waitForLogin };
