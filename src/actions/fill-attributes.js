/**
 * 填写商品属性（品牌、图案、风格、场景等下拉选择）
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 为某个属性标签选择值
 * @param {import('playwright').Page} page
 * @param {string} labelText - 属性标签文本，如 "风格"
 * @param {string} value - 要选的值，如 "创意"
 */
async function selectAttribute(page, labelText, value) {
  if (!value) {
    logger.warn(`  No value for "${labelText}", skipping`);
    return;
  }

  // 找到包含该 label 文本的最近区域，然后找其中的 select input
  // PDD MMS 用 beast-core-select 组件
  const labelArea = page.locator(`text=${labelText}`).first();
  if (await labelArea.count() === 0) {
    logger.warn(`  Label "${labelText}" not found on page`);
    return;
  }

  // 向上/向下找最近的 textbox
  let selectInput;
  try {
    // 尝试找同区域内的 select input
    const parent = labelArea.locator('..');
    selectInput = parent.locator('[data-testid="beast-core-select-htmlInput"]').first();
    if (await selectInput.count() === 0) {
      // 扩大搜索范围
      selectInput = page.locator('[data-testid="beast-core-select-htmlInput"]')
        .filter({ has: page.locator(`xpath=following::text()[contains(.,"${labelText}")]`) })
        .first();
    }
  } catch {
    // fallback: 找所有 textbox="请选择" 中离 label 最近的
    const allSelects = page.getByRole('textbox', { name: '请选择' });
    const count = await allSelects.count();
    for (let i = 0; i < count; i++) {
      const s = allSelects.nth(i);
      const box = await s.boundingBox();
      if (box) {
        selectInput = s;
        break;
      }
    }
  }

  if (!selectInput || await selectInput.count() === 0) {
    logger.warn(`  Cannot find select input for "${labelText}"`);
    return;
  }

  // 点击打开下拉
  await selectInput.click();
  await page.waitForTimeout(500);

  // 选择对应值的 option
  const option = page.getByRole('option', { name: value }).first();
  if (await option.count() > 0) {
    await option.click();
    await page.waitForTimeout(300);
    logger.info(`  "${labelText}" → "${value}"`);
  } else {
    // 试试直接文本点击
    try {
      await page.locator(`text=${value}`).first().click({ timeout: 3000 });
      await page.waitForTimeout(300);
      logger.info(`  "${labelText}" → "${value}" (text click)`);
    } catch {
      logger.warn(`  Option "${value}" not found for "${labelText}"`);
      await page.keyboard.press('Escape');
    }
  }
}

/**
 * 填写所有商品属性
 * @param {import('playwright').Page} page
 * @param {import('../data/product-mapper').Product} product
 */
async function fillAttributes(page, product) {
  logger.step('=== Filling Attributes ===');

  // 基础属性映射表 —— 根据类目可能需要调整
  const attrs = [
    { label: '图案', value: '卡通动漫' },
    { label: '风格', value: '创意' },
    { label: '适用场景', value: '通用' },
    { label: '是否支持定制', value: '支持定制' },
    { label: '重要印后工艺', value: '覆膜' },
    { label: '是否带音乐', value: '否' },
  ];

  // 先滚动到属性区域
  await page.evaluate(() => {
    const el = document.querySelector('[class*="property"], [class*="attr"]');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);

  for (const attr of attrs) {
    await selectAttribute(page, attr.label, attr.value);
  }

  await takeScreenshot(page, '07_attributes_filled');
  logger.info('Attributes filled');
}

module.exports = { fillAttributes, selectAttribute };
