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
  await page.goto(config.urls.mmsLogin, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);

  await takeScreenshot(page, '01_login_page');

  // 检测是否已经在首页（已登录）
  if (!page.url().includes('/login')) {
    logger.info('Already logged in (redirected to home)');
    return;
  }

  // 等待用户登录 —— 尝试检测 "账号登录" 标签
  const accountLoginTab = page.locator('text=账号登录');
  if (await accountLoginTab.count() > 0) {
    logger.info('Account login tab available');
  }

  logger.info('========================================');
  logger.info('Please log in manually (scan QR or use account login)');
  logger.info('Waiting for login to complete...');
  logger.info('========================================');

  // 轮询等待登录成功（最多2分钟）
  try {
    await page.waitForURL(
      url => !url.includes('/login'),
      { timeout: config.timeouts.login }
    );
    logger.info('Login detected!');
    await takeScreenshot(page, '02_login_success');
  } catch {
    throw new Error(`Login timeout after ${config.timeouts.login / 1000}s. Please try again.`);
  }
}

module.exports = { restoreSession, saveSession, waitForLogin };
