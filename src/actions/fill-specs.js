/**
 * 设置 SKU 规格维度（款式 + 容量）
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 添加一个规格类型并选择名称
 */
async function addSpecType(page, specName, specIndex) {
  // 点击 "添加规格类型"
  const addBtn = page.locator(config.selectors.spec.addSpecBtn);
  if (await addBtn.count() === 0) {
    logger.info('No "添加规格类型" button (may already have specs)');
    return;
  }
  await addBtn.click();
  await page.waitForTimeout(500);

  // 找到新的规格类型输入框并点击
  const specInput = page.getByRole('textbox', { name: `规格类型${specIndex}` });
  if (await specInput.count() === 0) {
    throw new Error(`Cannot find "规格类型${specIndex}" input`);
  }
  await specInput.click();
  await page.waitForTimeout(300);

  // 从下拉菜单选择
  const option = page.getByRole('option', { name: specName }).first();
  if (await option.count() > 0) {
    await option.click();
    await page.waitForTimeout(300);
    logger.info(`Spec type ${specIndex}: "${specName}"`);
  } else {
    throw new Error(`Spec type "${specName}" not found in dropdown options`);
  }
}

/**
 * 填入规格值（自动追加新空行）
 */
async function fillSpecValues(page, specName, values) {
  if (!values || values.length === 0) return;

  logger.step(`Filling "${specName}" values: ${values.join(', ')}`);

  // 找所有属于这个规格的输入框
  const customInputs = page.getByRole('textbox', { name: `自定义${specName}` });
  const count = await customInputs.count();

  if (count === 0) {
    throw new Error(`Cannot find "自定义${specName}" inputs`);
  }

  // 逐个填入 —— 每次填最后一个空框，系统会自动追加
  for (let i = 0; i < values.length; i++) {
    const inputs = page.getByRole('textbox', { name: `自定义${specName}` });
    const currentCount = await inputs.count();
    const lastInput = inputs.nth(currentCount - 1);

    await lastInput.fill(values[i]);
    await page.waitForTimeout(config.timeouts.reactRerender);
  }

  logger.info(`Filled ${values.length} values for "${specName}"`);
}

/**
 * 设置所有规格维度
 * @param {import('playwright').Page} page
 * @param {import('../data/product-mapper').Product} product
 */
async function fillSpecifications(page, product) {
  logger.step('=== Filling SKU Specifications ===');

  // 点击侧边栏或滚动到规格区域
  try {
    await page.evaluate(() => {
      const el = document.querySelector('[class*="sku"], [class*="spec"]');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(500);
  } catch { /* ignore */ }

  const dimensions = product.skuDimensions;
  if (dimensions.length === 0) {
    throw new Error('Product has no SKU dimensions defined');
  }

  // 添加并填写每个规格维度
  for (let i = 0; i < dimensions.length; i++) {
    const dim = dimensions[i];

    // 如果规格类型还不存在，添加它
    const specInput = page.getByRole('textbox', { name: `规格类型${i + 1}` });
    if (await specInput.count() === 0) {
      await addSpecType(page, dim.name, i + 1);
    }

    // 填写规格值
    await fillSpecValues(page, dim.name, dim.values);
  }

  await takeScreenshot(page, '08_specs_filled');
  logger.info(`Specifications complete: ${dimensions.map(d => d.name).join(', ')}`);
}

module.exports = { fillSpecifications, addSpecType, fillSpecValues };
