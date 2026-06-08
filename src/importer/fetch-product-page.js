/**
 * 打开商品页面并等待加载
 */
const logger = require('../helpers/logger');

async function fetchProductPage(page, url, importId) {
  logger.step(`Loading: ${url}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    // 检测验证码/登录页
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('verification')) {
      return { ok: false, error: `Page redirected to login/verification: ${currentUrl}` };
    }

    // 提取标题（作为初步验证页面加载成功）
    const title = await page.evaluate(() => {
      // PDD 商品标题通常在 h1 或包含 goods_name 的元素
      const h1 = document.querySelector('h1');
      if (h1) return h1.innerText.trim();
      // 尝试找标题元素
      const titleEl = document.querySelector('[class*="title"], [class*="name"], [class*="goods"]');
      if (titleEl) return titleEl.innerText.trim().substring(0, 100);
      return document.title.replace('拼多多', '').trim();
    });

    logger.info(`Page loaded: "${title}"`);
    return { ok: true, title };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { fetchProductPage };
