/**
 * JS 点击回退 —— 当 Playwright click 被遮挡时使用
 */
const logger = require('./logger');

/**
 * 通过 innerText 查找按钮并用 JS 点击
 * @param {import('playwright').Page} page
 * @param {string} text - 按钮文本
 * @returns {Promise<boolean>} 是否找到并点击
 */
async function jsClickByText(page, text) {
  const result = await page.evaluate((btnText) => {
    const btns = document.querySelectorAll('button, a, [role="button"]');
    for (const btn of btns) {
      if (btn.innerText && btn.innerText.includes(btnText)) {
        btn.click();
        return true;
      }
    }
    return false;
  }, text);

  if (result) {
    logger.info(`[jsClick] clicked "${text}"`);
  } else {
    logger.warn(`[jsClick] button "${text}" not found`);
  }
  return result;
}

/**
 * 通过选择器查找元素并用 JS 点击
 * @param {import('playwright').Page} page
 * @param {string} selector - CSS 选择器
 */
async function jsClick(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) { el.click(); return true; }
    return false;
  }, selector);
}

module.exports = { jsClickByText, jsClick };
