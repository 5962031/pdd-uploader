/**
 * 设置 SKU 规格维度 —— 动态遍历 product.skuDimensions
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 添加一个规格类型并选择名称
 */
async function addSpecType(page, specName, specIndex) {
  const addBtn = page.locator(config.selectors.spec.addSpecBtn);
  if (await addBtn.count() === 0) {
    logger.info('  No "添加规格类型" button — may already be added');
    return false;
  }
  await addBtn.click();
  await page.waitForTimeout(500);

  // 找规格类型输入框
  const specInput = page.getByRole('textbox', { name: `规格类型${specIndex}` });
  if (await specInput.count() === 0) {
    logger.warn(`  Cannot find "规格类型${specIndex}" input`);
    return false;
  }
  await specInput.click();
  await page.waitForTimeout(300);

  // 尝试从下拉菜单精确选择
  const option = page.getByRole('option', { name: specName }).first();
  if (await option.count() > 0) {
    await option.click();
    await page.waitForTimeout(300);
    logger.info(`  Spec type ${specIndex}: "${specName}" ✓`);
    return true;
  }

  // 模糊匹配
  const fuzzy = page.locator(`[role="option"]:has-text("${specName}")`).first();
  if (await fuzzy.count() > 0) {
    await fuzzy.click();
    await page.waitForTimeout(300);
    logger.info(`  Spec type ${specIndex}: "${specName}" (fuzzy) ✓`);
    return true;
  }

  // 尝试直接输入（有些版本支持自定义）
  try {
    await specInput.fill(specName);
    await page.waitForTimeout(300);
    logger.info(`  Spec type ${specIndex}: "${specName}" (typed) ✓`);
    return true;
  } catch {
    logger.warn(`  Cannot select or type "${specName}" for spec type ${specIndex}`);
    return false;
  }
}

/**
 * 填入规格值（多路径兼容）
 */
async function fillSpecValues(page, specName, values) {
  if (!values || values.length === 0) return;

  logger.info(`  Filling "${specName}": ${values.join(', ')}`);

  // 路径1: 标准 "自定义{specName}" role textbox
  const customInputs = page.getByRole('textbox', { name: `自定义${specName}` });
  if (await customInputs.count() > 0) {
    for (let i = 0; i < values.length; i++) {
      const inputs = page.getByRole('textbox', { name: `自定义${specName}` });
      const cc = await inputs.count();
      await inputs.nth(cc - 1).fill(values[i]);
      await page.waitForTimeout(config.timeouts.reactRerender);
    }
    logger.info(`  ✓ ${values.length} values filled via "自定义${specName}"`);
    return;
  }

  // 路径2: 用 placeholder 模糊匹配
  const fuzzyInputs = page.locator(`input[placeholder*="${specName}"], textbox[placeholder*="${specName}"]`);
  if (await fuzzyInputs.count() > 0) {
    for (let i = 0; i < values.length; i++) {
      const inputs = page.locator(`input[placeholder*="${specName}"]`);
      const cc = await inputs.count();
      await inputs.nth(cc - 1).fill(values[i]);
      await page.waitForTimeout(config.timeouts.reactRerender);
    }
    logger.info(`  ✓ ${values.length} values filled via placeholder "${specName}"`);
    return;
  }

  // 路径3: 页面已存在固定值（不是可编辑文本框），扫描并打印
  const allInputs = await page.evaluate(() => {
    return [...document.querySelectorAll('input[type="text"], input:not([type]), textbox')]
      .filter(e => e.offsetHeight > 0)
      .map(e => ({ placeholder: e.placeholder || '', value: e.value || '', tag: e.tagName }));
  });
  logger.warn(`  ⚠ Cannot find inputs for "${specName}". Visible inputs: ${JSON.stringify(allInputs.slice(0, 10))}`);

  // 路径4: 最后尝试用可见的最后一个空 textbox
  try {
    const allTb = page.getByRole('textbox');
    const tc = await allTb.count();
    for (let i = 0; i < values.length; i++) {
      const last = allTb.nth(tc - 1);
      await last.fill(values[i]);
      await page.waitForTimeout(config.timeouts.reactRerender);
    }
    logger.info(`  ✓ ${values.length} values filled via last-visible textbox fallback`);
    return;
  } catch (err) {
    logger.warn(`  ✗ All fill methods failed for "${specName}": ${err.message}`);
  }
}

/**
 * 调试：打印规格区所有可交互元素
 */
async function debugSpecArea(page) {
  try {
    const info = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => b.offsetHeight > 0).map(b => b.innerText.trim()).filter(Boolean);
      const inputs = [...document.querySelectorAll('input, textbox')].filter(e => e.offsetHeight > 0).map(e => ({ ph: e.placeholder || '', val: e.value?.substring(0, 20) || '' }));
      return { btns: btns.slice(0, 20), inputs: inputs.slice(0, 20) };
    });
    logger.debug(`  Spec area buttons: ${JSON.stringify(info.btns)}`);
    logger.debug(`  Spec area inputs: ${JSON.stringify(info.inputs)}`);
  } catch {}
}

/**
 * 主入口
 */
async function fillSpecifications(page, product) {
  logger.step('=== Filling SKU Specifications ===');

  await page.evaluate(() => {
    const el = document.querySelector('[class*="sku"], [class*="spec"], table');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);

  const dimensions = product.skuDimensions;
  if (dimensions.length === 0) {
    logger.info('No SKU dimensions — single SKU, skipping spec creation');
    return;
  }

  logger.info(`Dimensions (${dimensions.length}): ${dimensions.map(d => d.name + '(' + d.values.length + ')').join(', ')}`);

  for (let i = 0; i < dimensions.length; i++) {
    const dim = dimensions[i];
    logger.info(`  Spec ${i + 1}: ${dim.name} → ${dim.values.join(', ')}`);

    // 检查规格类型是否已存在
    const specInput = page.getByRole('textbox', { name: `规格类型${i + 1}` });
    if (await specInput.count() === 0) {
      const added = await addSpecType(page, dim.name, i + 1);
      if (!added) {
        await debugSpecArea(page);
        logger.warn(`  Could not add spec type "${dim.name}" — trying to fill values anyway`);
      }
    }

    // 填写规格值
    await fillSpecValues(page, dim.name, dim.values);
  }

  await takeScreenshot(page, '08_specs_filled');
  logger.info(`Specs: ${dimensions.map(d => d.name).join(', ')} ✓`);
}

module.exports = { fillSpecifications };
