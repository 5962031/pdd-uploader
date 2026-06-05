/**
 * 分类选择页 —— 用"最近使用的分类"一键选择或搜索回退
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 选择商品类目并进入发布表单
 * @param {import('playwright').Page} page
 * @param {string[]} categoryPath - e.g. ['数码电器', '文具电教/...', '纸张本册', '不干胶标签']
 */
async function selectCategory(page, categoryPath) {
  logger.step('Selecting product category...');

  // 进入发布页面
  await page.goto(config.urls.goodsList, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // 点击侧边栏或页面中的 "发布新商品"
  const publishLink = page.locator('a:has-text("发布新商品"), link:has-text("发布新商品")').first();
  if (await publishLink.count() > 0) {
    await publishLink.click();
    await page.waitForTimeout(2000);
  } else {
    // 直接导航到分类页
    await page.goto(config.urls.goodsCategory, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  }

  // 等分类页加载
  await page.waitForTimeout(2000);
  await takeScreenshot(page, '03_category_page');

  // ---- 策略 A: 使用"最近使用的分类" ----
  const recentUsed = page.locator(config.selectors.category.recentUsed).first();
  let recentFound = false;

  try {
    await recentUsed.waitFor({ state: 'visible', timeout: 3000 });
    recentFound = true;
  } catch {
    logger.info('"最近使用的分类" not visible');
  }

  if (recentFound) {
    logger.step('Using "最近使用的分类" to select category...');

    // 点击每一级分类名称
    for (const level of categoryPath) {
      const levelEl = page.locator(`text=${level}`).first();
      try {
        await levelEl.click({ timeout: 5000 });
        await page.waitForTimeout(500);
        logger.info(`  Clicked: ${level}`);
      } catch {
        // 可能已经选中，或需要展开父级
        logger.warn(`  Could not click "${level}", trying partial match...`);
        // 尝试部分匹配
        const parts = level.split('/');
        for (const part of parts) {
          try {
            await page.locator(`text=${part.trim()}`).first().click({ timeout: 3000 });
            await page.waitForTimeout(400);
          } catch { /* skip */ }
        }
      }
    }

    await takeScreenshot(page, '03_category_selected');
  }

  // ---- 策略 B: 搜索回退 ----
  if (!recentFound) {
    logger.step('Falling back to category search...');
    const searchBox = page.locator(config.selectors.category.searchBox);
    if (await searchBox.count() > 0) {
      await searchBox.first().fill(categoryPath[categoryPath.length - 1]);
      await page.waitForTimeout(1000);
      // 从搜索结果中选择
      const leafName = categoryPath[categoryPath.length - 1];
      await page.locator(`text=${leafName}`).first().click({ timeout: 5000 });
      await page.waitForTimeout(500);
    }
  }

  // ---- 确认发布 ----
  const confirmBtn = page.locator(config.selectors.category.confirmBtn);
  try {
    await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
    logger.step('Clicking confirm...');
    await confirmBtn.click();
    await page.waitForTimeout(3000);
  } catch {
    throw new Error('Cannot find "确认发布该类商品" button. Is the category fully selected?');
  }

  // 等待发布表单加载
  try {
    await page.waitForURL(
      url => url.includes('goods_add') || url.includes('goods_id'),
      { timeout: 10000 }
    );
  } catch {
    throw new Error('Form page did not load after category confirmation');
  }

  await takeScreenshot(page, '04_form_loaded');
  logger.info('Category selected, form loaded');
}

module.exports = { selectCategory };
